#!/usr/bin/env node
// PHI-shape sweep over the working tree.
//
// Enforces the no-PHI claim made in README.md and SECURITY.md by scanning text
// files for shapes that resemble Protected Health Information. This is NOT a
// complete PHI validator. It catches a small, high-confidence set of patterns
// that should never appear in this repository under any circumstances.
//
// What it catches:
//   - US Social Security Number format (NNN-NN-NNNN), with invalid SSA ranges
//     excluded to reduce false positives.
//   - US 10-digit phone numbers in (NNN) NNN-NNNN, NNN-NNN-NNNN, or
//     NNN.NNN.NNNN form.
//   - Email addresses with a domain not on the allowlist of public references
//     (FHIR sandbox, GitHub, AWS, code-system standards bodies, etc.).
//
// What it deliberately does NOT catch (documented in docs/security-automation.md):
//   - Personal names. Far too many false positives in source identifiers.
//   - Dates of birth. Collide with ISO 8601 timestamps and changelog dates.
//   - Generic medical record numbers. No standard format.
//   - Free-text medical notes. Out of scope for a regex-based check.
//
// Usage:
//   node scripts/check-phi.mjs            # scan from cwd
//   node scripts/check-phi.mjs <path>     # scan from <path>
//
// Exit codes:
//   0 - clean
//   1 - findings reported

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { argv, cwd, exit } from "node:process";

const ROOT = argv[2] ?? cwd();

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".idea",
  ".vscode",
]);

const EXCLUDED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  // Self-exclusion: this script names the patterns it scans for.
  "check-phi.mjs",
]);

// Domains that are NOT PHI when they appear in an email-shaped string. Add
// here if a legitimate public reference is being flagged.
const ALLOWED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "smarthealthit.org",
  "hl7.org",
  "loinc.org",
  "snomed.info",
  "anthropic.com",
  "github.com",
  "githubusercontent.com",
  "amazonaws.com",
  "modelcontextprotocol.io",
]);

const RULES = [
  {
    id: "ssn",
    description: "US Social Security Number format (NNN-NN-NNNN)",
    // Excludes invalid SSA ranges: area 000, 666, 900-999; group 00; serial 0000.
    regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    id: "us-phone",
    description: "US 10-digit phone number",
    regex: /\b(?:\(\d{3}\)\s?|\d{3}[-.])\d{3}[-.]\d{4}\b/g,
  },
  {
    id: "email-non-allowlisted",
    description: "Email address with a non-allowlisted domain",
    regex: /\b[a-zA-Z0-9._%+\-]+@([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g,
    inspect: (groups) => {
      const domain = groups[1].toLowerCase();
      const parts = domain.split(".");
      // Match against allowlist on the full domain or any parent suffix
      // (so noreply@x.github.com passes if github.com is allowlisted).
      // Stop one step short of the bare TLD so we never allowlist a whole TLD.
      for (let i = 0; i < parts.length - 1; i++) {
        if (ALLOWED_EMAIL_DOMAINS.has(parts.slice(i).join("."))) return false;
      }
      return true;
    },
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walk(path);
      continue;
    }
    if (entry.isFile()) {
      if (EXCLUDED_FILES.has(basename(path))) continue;
      const stat = statSync(path);
      if (stat.size > 1_000_000) continue;
      yield path;
    }
  }
}

function isLikelyText(buffer) {
  const slice = buffer.subarray(0, Math.min(1024, buffer.length));
  for (const byte of slice) if (byte === 0) return false;
  return true;
}

function scanFile(path) {
  const buffer = readFileSync(path);
  if (!isLikelyText(buffer)) return [];
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      rule.regex.lastIndex = 0;
      let m;
      while ((m = rule.regex.exec(line)) !== null) {
        if (rule.inspect && !rule.inspect(m)) continue;
        findings.push({
          path: relative(ROOT, path),
          line: i + 1,
          col: m.index + 1,
          rule: rule.id,
          description: rule.description,
          matched: m[0],
        });
      }
    }
  }
  return findings;
}

function main() {
  const findings = [];
  for (const path of walk(ROOT)) findings.push(...scanFile(path));

  if (findings.length === 0) {
    console.log(`PHI sweep clean: 0 findings under ${relative(cwd(), ROOT) || "."}`);
    return 0;
  }

  console.error(`PHI sweep found ${findings.length} candidate issue(s):`);
  for (const f of findings) {
    console.error(`  ${f.path}:${f.line}:${f.col}  [${f.rule}]  ${f.description}`);
    console.error(`    matched: ${f.matched}`);
  }
  console.error("");
  console.error("Each finding is a candidate, not a confirmed leak.");
  console.error("If the value is a public reference that should be exempt, update the allowlist in scripts/check-phi.mjs.");
  return 1;
}

exit(main());
