import { createHmac } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { Config } from "../config.js";

export type AuditStatus = "success" | "error";

export interface AuditRecord {
  timestamp: string;
  tool: string;
  patient_id_hmac: string;
  caller_identity: string;
  request_id: string;
  status: AuditStatus;
  error_code?: string;
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
  constructor(private readonly config: Config) {}

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
    const record: AuditRecord = {
      timestamp: new Date().toISOString(),
      ...rest,
      patient_id_hmac: this.hmac(patient_id),
    };
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
