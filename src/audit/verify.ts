import { timingSafeEqual } from "node:crypto";
import { type AuditRecord, auditMac } from "./logger.js";

export interface AuditVerification {
  /** Records whose mac and chain position were confirmed. */
  verified: number;
  /** Records written under another key or before chaining existed. */
  skipped: number;
  /** One line per defect; empty when the log is intact. */
  problems: string[];
}

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks every chained record written under `keyId`: the mac matches the
 * content, and each chain runs 0..n without a gap, a repeat or a broken link.
 * It cannot see records removed from the end of a chain, or a whole chain removed.
 */
export function verifyAuditLines(
  lines: string[],
  key: string,
  keyId: string,
  options: { strict?: boolean } = {},
): AuditVerification {
  const result: AuditVerification = { verified: 0, skipped: 0, problems: [] };
  const chains = new Map<string, AuditRecord[]>();
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let record: AuditRecord;
    try {
      record = JSON.parse(line) as AuditRecord;
    } catch {
      result.problems.push(`line ${index + 1}: not JSON`);
      continue;
    }
    if (
      record.key_id !== keyId ||
      typeof record.mac !== "string" ||
      typeof record.chain_id !== "string" ||
      !Number.isInteger(record.seq)
    ) {
      result.skipped += 1;
      // Strict: a log expected to hold one key must not carry unverifiable records.
      if (options.strict)
        result.problems.push(`line ${index + 1}: not chained under this key`);
      continue;
    }
    const { mac, ...unsigned } = record;
    if (!same(mac, auditMac(key, unsigned))) {
      result.problems.push(`line ${index + 1}: mac does not match the record`);
      continue;
    }
    const chain = chains.get(record.chain_id) ?? [];
    chain.push(record);
    chains.set(record.chain_id, chain);
  }
  for (const [chainId, chain] of chains) {
    chain.sort((a, b) => a.seq - b.seq);
    let prev: string | null = null;
    for (const [position, record] of chain.entries()) {
      if (record.seq !== position || record.prev !== prev) {
        result.problems.push(
          `chain ${chainId}: record missing, repeated or relinked near seq ${position}`,
        );
        break;
      }
      prev = record.mac;
      result.verified += 1;
    }
  }
  return result;
}
