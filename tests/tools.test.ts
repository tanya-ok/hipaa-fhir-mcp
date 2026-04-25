import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogger, hashPatientId } from "../src/audit/logger.js";
import type { Config } from "../src/config.js";
import { FhirError, type FhirClient } from "../src/fhir/client.js";
import type {
  MedicationRequest,
  Observation,
  Patient,
} from "../src/fhir/types.js";
import { getMedicationList } from "../src/tools/get-medication-list.js";
import { getPatient } from "../src/tools/get-patient.js";
import { searchObservations } from "../src/tools/search-observations.js";
import type { ToolDeps } from "../src/tools/types.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    FHIR_BASE_URL: "https://r4.smarthealthit.org",
    CALLER_IDENTITY: "test-caller",
    NODE_ENV: "test",
    REQUEST_TIMEOUT_MS: 5_000,
    ...overrides,
  };
}

class StubFhirClient implements FhirClient {
  constructor(
    private readonly impl: Partial<FhirClient> = {},
  ) {}

  getPatient(patientId: string): Promise<Patient> {
    if (this.impl.getPatient) {
      return this.impl.getPatient(patientId);
    }
    throw new Error("getPatient not stubbed");
  }

  searchObservations(patientId: string, code: string): Promise<Observation[]> {
    if (this.impl.searchObservations) {
      return this.impl.searchObservations(patientId, code);
    }
    throw new Error("searchObservations not stubbed");
  }

  getMedicationRequests(patientId: string): Promise<MedicationRequest[]> {
    if (this.impl.getMedicationRequests) {
      return this.impl.getMedicationRequests(patientId);
    }
    throw new Error("getMedicationRequests not stubbed");
  }
}

describe("audit logger", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "hipaa-fhir-mcp-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes one line per record with hashed patient id and no PHI", async () => {
    const file = path.join(tmp, "audit.log");
    const audit = new AuditLogger(
      makeConfig({ NODE_ENV: "development", AUDIT_LOG_FILE: file }),
    );

    await audit.record({
      tool: "get_patient",
      patient_id_hash: hashPatientId("smart-12345"),
      caller_identity: "test",
      request_id: "req-1",
      status: "success",
    });

    const contents = await readFile(file, "utf8");
    const line = contents.trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      tool: "get_patient",
      caller_identity: "test",
      request_id: "req-1",
      status: "success",
    });
    expect(parsed.patient_id_hash).toBe(hashPatientId("smart-12345"));
    expect(line).not.toContain("smart-12345");
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("falls back to stdout when the file sink fails", async () => {
    const audit = new AuditLogger(
      makeConfig({
        NODE_ENV: "development",
        AUDIT_LOG_FILE: path.join(tmp, "does-not-exist", "audit.log"),
      }),
    );
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await audit.record({
      tool: "get_patient",
      patient_id_hash: "h",
      caller_identity: "t",
      request_id: "r",
      status: "success",
    });

    expect(stdoutSpy).toHaveBeenCalledOnce();
    expect(stderrSpy).toHaveBeenCalled();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe("tools", () => {
  let tmp: string;
  let auditFile: string;

  async function makeDeps(client: FhirClient): Promise<ToolDeps> {
    const config = makeConfig({
      NODE_ENV: "development",
      AUDIT_LOG_FILE: auditFile,
    });
    return {
      config,
      fhir: client,
      audit: new AuditLogger(config),
    };
  }

  async function readAuditLines(): Promise<Record<string, unknown>[]> {
    const contents = await readFile(auditFile, "utf8");
    return contents
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "hipaa-fhir-mcp-"));
    auditFile = path.join(tmp, "audit.log");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("get_patient returns the resource and audits a success record", async () => {
    const patient: Patient = {
      resourceType: "Patient",
      id: "smart-12345",
      gender: "female",
      birthDate: "1985-04-01",
    };
    const deps = await makeDeps(
      new StubFhirClient({ getPatient: async () => patient }),
    );

    const result = await getPatient({ patient_id: "smart-12345" }, deps);
    expect(result).toBe(patient);

    const audit = await readAuditLines();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tool: "get_patient",
      status: "success",
      patient_id_hash: hashPatientId("smart-12345"),
    });
  });

  it("get_patient surfaces FHIR errors and audits an error code", async () => {
    const deps = await makeDeps(
      new StubFhirClient({
        getPatient: async () => {
          throw new FhirError("not found", 404);
        },
      }),
    );

    await expect(
      getPatient({ patient_id: "unknown-1" }, deps),
    ).rejects.toBeInstanceOf(FhirError);

    const audit = await readAuditLines();
    expect(audit[0]).toMatchObject({
      tool: "get_patient",
      status: "error",
      error_code: "fhir_404",
    });
  });

  it("search_observations returns bundle resources and audits", async () => {
    const obs: Observation = {
      resourceType: "Observation",
      id: "o-1",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
    };
    const deps = await makeDeps(
      new StubFhirClient({
        searchObservations: async (_p, _c) => [obs],
      }),
    );

    const result = await searchObservations(
      { patient_id: "smart-12345", code: "http://loinc.org|8867-4" },
      deps,
    );
    expect(result).toEqual([obs]);

    const audit = await readAuditLines();
    expect(audit[0]).toMatchObject({
      tool: "search_observations",
      status: "success",
    });
  });

  it("get_medication_list returns requests and audits", async () => {
    const med: MedicationRequest = {
      resourceType: "MedicationRequest",
      id: "mr-1",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/smart-12345" },
    };
    const deps = await makeDeps(
      new StubFhirClient({
        getMedicationRequests: async () => [med],
      }),
    );

    const result = await getMedicationList(
      { patient_id: "smart-12345" },
      deps,
    );
    expect(result).toEqual([med]);

    const audit = await readAuditLines();
    expect(audit[0]).toMatchObject({
      tool: "get_medication_list",
      status: "success",
    });
  });

  it("non-FHIR errors are audited as internal_error", async () => {
    const deps = await makeDeps(
      new StubFhirClient({
        getPatient: async () => {
          throw new Error("boom");
        },
      }),
    );

    await expect(getPatient({ patient_id: "x" }, deps)).rejects.toThrow("boom");

    const audit = await readAuditLines();
    expect(audit[0]).toMatchObject({
      status: "error",
      error_code: "internal_error",
    });
  });
});
