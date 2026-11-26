#!/usr/bin/env node
// Verifies the hash chain of an audit log file written by the built server.
// Usage: AUDIT_HMAC_KEY=<key> node scripts/verify-audit.mjs [--strict] <audit.jsonl>
// --strict also fails on records under another key or without chain fields.
// Prints counts and defects only; no record content is printed.
import { readFileSync } from "node:fs";
import { AuditLogger } from "../dist/audit/logger.js";
import { verifyAuditLines } from "../dist/audit/verify.js";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const [file] = args.filter((arg) => arg !== "--strict");
const key = process.env.AUDIT_HMAC_KEY;
if (!file || !key) {
  process.stderr.write(
    "Usage: AUDIT_HMAC_KEY=<key> node scripts/verify-audit.mjs [--strict] <audit.jsonl>\n",
  );
  process.exit(2);
}
const { keyId } = new AuditLogger({ AUDIT_HMAC_KEY: key });
const result = verifyAuditLines(
  readFileSync(file, "utf8").split("\n"),
  key,
  keyId,
  { strict },
);
for (const problem of result.problems) console.log(problem);
console.log(
  `${result.verified} verified, ${result.skipped} skipped (other key or unchained), ${result.problems.length} problems`,
);
process.exit(result.problems.length ? 1 : 0);
