import { createHash, createHmac, randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { Config } from "../config.js";

export type AuditStatus = "success" | "error";

export interface AuditRecord {
  timestamp: string;
  tool: string;
  patient_id_hmac: string;
  /** Which HMAC key produced the digest, so records stay attributable across key rotation. */
  key_id: string;
  caller_identity: string;
  request_id: string;
  status: AuditStatus;
  error_code?: string;
  /** One chain per process start; seq counts from 0 inside it. */
  chain_id: string;
  seq: number;
  /** mac of the previous record in this chain, null for the first. */
  prev: string | null;
  /** HMAC-SHA-256 of the record without this field, under the audit key. */
  mac: string;
}

/** The exact bytes the mac covers: the record without mac, in written key order. */
export function auditMac(
  key: string,
  record: Omit<AuditRecord, "mac">,
): string {
  return createHmac("sha256", key)
    .update(`hipaa-fhir-mcp audit chain:${JSON.stringify(record)}`, "utf8")
    .digest("hex");
}

export interface AuditInput {
  tool: string;
  patient_id: string;
  caller_identity: string;
  request_id: string;
  status: AuditStatus;
  error_code?: string;
}

export class AuditLogger {
  /** A one-way label of the key; the key itself cannot be derived from it. */
  readonly keyId: string;
  private readonly chainId = randomUUID();
  private seq = 0;
  private prev: string | null = null;

  constructor(private readonly config: Config) {
    this.keyId = createHash("sha256")
      .update(
        `hipaa-fhir-mcp audit key id:${config.AUDIT_HMAC_KEY.toLowerCase()}`,
      )
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Compute the keyed HMAC of a patient id. The plaintext id is never
   * stored or returned; callers receive only the digest. The key lives
   * in `config.AUDIT_HMAC_KEY` and in production should be sourced from
   * a secrets manager (Secrets Manager, Vault, KMS-derived, etc.).
   */
  hmac(patientId: string): string {
    return createHmac("sha256", this.config.AUDIT_HMAC_KEY)
      .update(patientId, "utf8")
      .digest("hex");
  }

  async record(entry: AuditInput): Promise<void> {
    const { patient_id, ...rest } = entry;
    // Assigned synchronously, so concurrent calls still get a strict order.
    const unsigned: Omit<AuditRecord, "mac"> = {
      timestamp: new Date().toISOString(),
      ...rest,
      patient_id_hmac: this.hmac(patient_id),
      key_id: this.keyId,
      chain_id: this.chainId,
      seq: this.seq++,
      prev: this.prev,
    };
    const mac = auditMac(this.config.AUDIT_HMAC_KEY, unsigned);
    this.prev = mac;
    const record: AuditRecord = { ...unsigned, mac };
    const line = `${JSON.stringify(record)}\n`;

    const file = this.config.AUDIT_LOG_FILE;

    if (!file) {
      process.stderr.write(line);
      return;
    }

    try {
      await appendFile(file, line, "utf8");
    } catch {
      process.stderr.write(line);
      process.stderr.write("audit: file sink failed, using stderr\n");
    }
  }
}
