import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit/logger.js";
import { verifyAuditLines } from "../src/audit/verify.js";
import { ConfigSchema } from "../src/config.js";

const KEY = "ab".repeat(32);
const dir = mkdtempSync(path.join(tmpdir(), "audit-chain-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function write(name: string, count: number, key = KEY) {
  const file = path.join(dir, name);
  const audit = new AuditLogger(
    ConfigSchema.parse({
      AUDIT_HMAC_KEY: key,
      AUDIT_LOG_FILE: file,
      NODE_ENV: "test",
    }),
  );
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      audit.record({
        tool: "get_patient",
        patient_id: `synthetic-${i}`,
        caller_identity: "synthetic-label",
        request_id: `r-${i}`,
        status: "success",
      }),
    ),
  );
  return {
    keyId: audit.keyId,
    lines: readFileSync(file, "utf8").trimEnd().split("\n"),
  };
}

describe("audit hash chain", () => {
  it("verifies an untouched log, including concurrent writes", async () => {
    const { lines, keyId } = await write("ok.jsonl", 20);
    expect(verifyAuditLines(lines, KEY, keyId)).toEqual({
      verified: 20,
      skipped: 0,
      problems: [],
    });
  });

  it("reports an edited record", async () => {
    const { lines, keyId } = await write("edited.jsonl", 5);
    lines[2] = (lines[2] ?? "").replace('"success"', '"error"');
    const result = verifyAuditLines(lines, KEY, keyId);
    expect(result.problems.join(" ")).toContain("line 3: mac does not match");
  });

  it("reports a removed record", async () => {
    const { lines, keyId } = await write("removed.jsonl", 5);
    const kept = lines.filter((line) => !line.includes('"seq":2,'));
    expect(kept).toHaveLength(4);
    const result = verifyAuditLines(kept, KEY, keyId);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain("missing, repeated or relinked");
  });

  it("reports a repeated record", async () => {
    const { lines, keyId } = await write("repeated.jsonl", 3);
    const result = verifyAuditLines([...lines, lines[1] ?? ""], KEY, keyId);
    expect(result.problems).toHaveLength(1);
  });

  it("cannot be re-signed without the key", async () => {
    const { lines, keyId } = await write("forged.jsonl", 3);
    const result = verifyAuditLines(lines, "cd".repeat(32), keyId);
    expect(result.verified).toBe(0);
    expect(result.problems).toHaveLength(3);
  });

  it("skips records written under another key", async () => {
    const old = await write("rotated-old.jsonl", 2, "ef".repeat(32));
    const current = await write("rotated-new.jsonl", 3);
    const result = verifyAuditLines(
      [...old.lines, ...current.lines],
      KEY,
      current.keyId,
    );
    expect(result).toEqual({ verified: 3, skipped: 2, problems: [] });
  });

  it("reports lines that are not objects instead of failing", async () => {
    const { lines, keyId } = await write("shapes.jsonl", 1);
    const result = verifyAuditLines([...lines, "null", "[]", "42"], KEY, keyId);
    expect(result.verified).toBe(1);
    expect(result.problems).toEqual([
      "line 2: not an audit record",
      "line 3: not an audit record",
      "line 4: not an audit record",
    ]);
  });

  it("reports skipped records in strict mode", async () => {
    const { lines, keyId } = await write("strict.jsonl", 2);
    const injected = JSON.stringify({ tool: "get_patient", key_id: "other" });
    const result = verifyAuditLines([...lines, injected], KEY, keyId, {
      strict: true,
    });
    expect(result.verified).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.problems).toEqual(["line 3: not chained under this key"]);
  });
});
