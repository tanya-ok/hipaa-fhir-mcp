#!/usr/bin/env node
// Classifies a change by the paths it touches. Deterministic, fails closed:
// a path that matches no rule counts as T2.
//   node scripts/risk-tier.mjs <base> [head]   compare two git refs
//   node scripts/risk-tier.mjs --stdin         read one path per line
// With --agent, exits 1 if the change touches a path agents may not edit or
// removes more test assertions than it adds.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Agents never edit these: CI, supply chain, release, audit core, own rules.
const FORBIDDEN = [
  /^\.github\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^\.npmrc$/,
  /^biome\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^vitest\.config\.[cm]?[jt]s$/,
  /^server\.json$/,
  /^glama\.json$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^SECURITY\.md$/,
  /^LICENSE$/,
  /^\.gitleaks/,
  /^\.gitignore$/,
  /^\.dockerignore$/,
  /^Dockerfile$/,
  /^requirements-docs\.txt$/,
  /^zensical\.toml$/,
  /^docs\/agents\//,
  /^deploy\/demo\/(Dockerfile|fly\.toml)$/,
  /^scripts\/(risk-tier|check-phi|verify-audit|package-mcpb)\.mjs$/,
  /^scripts\/(check|test)-mcpb\.py$/,
  /^src\/audit\//,
  /^src\/http\.ts$/,
];

const T0 = [/^docs\/.*\.md$/, /^README\.md$/, /^CHANGELOG\.md$/];

const T1 = [
  /^src\/fhir\//,
  /^src\/tools\//,
  /^tests\//,
  /^patient-policy\.example\.json$/,
  /^deploy\/demo\/patient-policy\.json$/,
  /^deploy\/medplum-lab\/(seed\.mjs|README\.md)$/,
  /^scripts\/(smoke-live|demo-package)\.mjs$/,
];

// Everything else, including src/security/, src/mcp.ts, src/config.ts and
// manifest.json, is T2: allowed for agents, merged only after human review.

export function classify(paths) {
  const forbidden = paths.filter((p) => FORBIDDEN.some((r) => r.test(p)));
  const tierOf = (p) => {
    if (FORBIDDEN.some((r) => r.test(p))) return 2;
    if (T0.some((r) => r.test(p))) return 0;
    if (T1.some((r) => r.test(p))) return 1;
    return 2;
  };
  const tier = paths.length ? Math.max(...paths.map(tierOf)) : 0;
  return { tier: `T${tier}`, forbidden };
}

// Net change in `expect(` calls under tests/, from a unified diff.
export function assertionDelta(diff) {
  let file = "";
  let delta = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) file = line.slice(6);
    else if (!file.startsWith("tests/") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) delta += count(line);
    else if (line.startsWith("-")) delta -= count(line);
  }
  return delta;
}

const count = (line) => (line.match(/\bexpect\(/g) ?? []).length;

function main(argv) {
  const agent = argv.includes("--agent");
  const args = argv.filter((a) => !a.startsWith("--"));
  let paths;
  let diff = "";
  if (argv.includes("--stdin")) {
    paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
  } else {
    const range = `${args[0] ?? "origin/main"}...${args[1] ?? "HEAD"}`;
    const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
    paths = git("diff", "--name-only", range).split("\n").filter(Boolean);
    diff = git("diff", "--unified=0", range, "--", "tests");
  }
  const result = { ...classify(paths), assertionDelta: assertionDelta(diff) };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!agent) return 0;
  const problems = [
    ...result.forbidden.map((p) => `agents may not edit ${p}`),
    ...(result.assertionDelta < 0
      ? [`tests lose ${-result.assertionDelta} assertion(s)`]
      : []),
  ];
  for (const p of problems) process.stderr.write(`risk-tier: ${p}\n`);
  return problems.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
