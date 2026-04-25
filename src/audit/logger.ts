import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { Config } from "../config.js";

export type AuditStatus = "success" | "error";

export interface AuditRecord {
  timestamp: string;
  tool: string;
  patient_id_hash: string;
  caller_identity: string;
  request_id: string;
  status: AuditStatus;
  error_code?: string;
}

export type AuditInput = Omit<AuditRecord, "timestamp">;

export function hashPatientId(patientId: string): string {
  return createHash("sha256").update(patientId, "utf8").digest("hex");
}

export class AuditLogger {
  constructor(private readonly config: Config) {}

  async record(entry: AuditInput): Promise<void> {
    const record: AuditRecord = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const line = `${JSON.stringify(record)}\n`;

    const useFile =
      this.config.NODE_ENV !== "production" && this.config.AUDIT_LOG_FILE;

    if (!useFile) {
      process.stdout.write(line);
      return;
    }

    try {
      await appendFile(this.config.AUDIT_LOG_FILE as string, line, "utf8");
    } catch (err) {
      process.stdout.write(line);
      process.stderr.write(
        `audit: file sink failed, fell back to stdout: ${(err as Error).message}\n`,
      );
    }
  }
}
