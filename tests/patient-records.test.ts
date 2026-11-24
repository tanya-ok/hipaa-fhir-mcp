import axios, { type AxiosAdapter, AxiosHeaders } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../src/audit/logger.js";
import { ConfigSchema } from "../src/config.js";
import { FhirError, HttpFhirClient } from "../src/fhir/client.js";
import { requestContext } from "../src/security/context.js";
import { createPatientAuthorizer } from "../src/security/patient-policy.js";
import { getPatientSummary } from "../src/tools/patient-records.js";

const PATIENT = "synthetic-1";
const bundle = (resources: unknown[]) => ({
  resourceType: "Bundle",
  type: "searchset",
  entry: resources.map((resource) => ({ resource })),
  link: [],
});
const concept = (code: string) => ({
  coding: [
    { system: "http://snomed.info/sct", code, display: "private-display" },
  ],
  text: "private-text",
});
const status = (code: string) => ({ coding: [{ code }] });

const originalAdapter = axios.defaults.adapter;
afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

function client(responses: unknown[]) {
  const requests: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config.url ?? "");
    return {
      config,
      data: responses.shift(),
      headers: new AxiosHeaders(),
      status: 200,
      statusText: "OK",
    };
  };
  axios.defaults.adapter = adapter;
  const fhir = new HttpFhirClient(
    ConfigSchema.parse({
      AUDIT_HMAC_KEY: "a".repeat(64),
      FHIR_BASE_URL: "https://example.org/fhir",
    }),
  );
  return { fhir, requests };
}

describe("additional FHIR resources", () => {
  it("checks AllergyIntolerance.patient and drops free text", async () => {
    const { fhir, requests } = client([
      bundle([
        {
          resourceType: "AllergyIntolerance",
          id: "a-1",
          criticality: "high",
          code: concept("91936005"),
          patient: { reference: `Patient/${PATIENT}`, display: "private-name" },
          note: [{ text: "private-note" }],
        },
      ]),
    ]);
    const result = await fhir.getAllergies(PATIENT);
    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(requests[0]).toContain("AllergyIntolerance?patient=synthetic-1");
  });

  it("refuses an Immunization for another patient", async () => {
    const { fhir } = client([
      bundle([
        {
          resourceType: "Immunization",
          id: "i-1",
          status: "completed",
          vaccineCode: concept("140"),
          patient: { reference: "Patient/someone-else" },
        },
      ]),
    ]);
    await expect(fhir.getImmunizations(PATIENT)).rejects.toThrow(
      "Unexpected FHIR subject",
    );
  });

  it("sends the encounter start date as a date search", async () => {
    const { fhir, requests } = client([bundle([])]);
    await fhir.getEncounters(PATIENT, "2024-01-01");
    expect(new URL(requests[0] ?? "").searchParams.get("date")).toBe(
      "ge2024-01-01",
    );
  });

  it("refuses a Condition with an unexpected shape", async () => {
    const { fhir } = client([
      bundle([{ resourceType: "Condition", id: "c-1" }]),
    ]);
    await expect(fhir.getConditions(PATIENT)).rejects.toBeInstanceOf(FhirError);
  });
});

describe("patient summary", () => {
  it("keeps only active conditions and allergies with one audit record", async () => {
    const config = ConfigSchema.parse({
      AUDIT_HMAC_KEY: "a".repeat(64),
      NODE_ENV: "test",
    });
    const audit = new AuditLogger(config);
    const record = vi.spyOn(audit, "record").mockResolvedValue();
    const subject = { reference: `Patient/${PATIENT}` };
    const fhir = {
      getPatient: vi.fn(async () => ({
        resourceType: "Patient" as const,
        id: PATIENT,
      })),
      searchObservations: vi.fn(async () => []),
      getMedicationRequests: vi.fn(async () => []),
      getConditions: vi.fn(async () => [
        {
          resourceType: "Condition" as const,
          id: "c-1",
          subject,
          clinicalStatus: status("active"),
        },
        {
          resourceType: "Condition" as const,
          id: "c-2",
          subject,
          clinicalStatus: status("resolved"),
        },
      ]),
      getAllergies: vi.fn(async () => [
        {
          resourceType: "AllergyIntolerance" as const,
          id: "a-1",
          patient: subject,
          clinicalStatus: status("inactive"),
        },
        {
          resourceType: "AllergyIntolerance" as const,
          id: "a-2",
          patient: subject,
        },
      ]),
      getImmunizations: vi.fn(async () => []),
      getEncounters: vi.fn(async () => []),
    };
    const principal = "spiffe://example.org/synthetic-a";
    const summary = await getPatientSummary(
      { patient_id: PATIENT },
      {
        config,
        audit,
        fhir,
        authorizer: createPatientAuthorizer({
          version: 1,
          grants: [
            { principal, patients: [PATIENT], tools: ["get_patient_summary"] },
          ],
        }),
        context: requestContext(principal, "spiffe-mtls+token"),
      },
    );
    expect(summary.active_conditions.map((c) => c.id)).toEqual(["c-1"]);
    expect(summary.allergies.map((a) => a.id)).toEqual(["a-2"]);
    expect(fhir.getImmunizations).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      tool: "get_patient_summary",
      status: "success",
    });
  });
});
