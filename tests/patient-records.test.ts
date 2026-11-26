import axios, { type AxiosAdapter, AxiosHeaders } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../src/audit/logger.js";
import { ConfigSchema } from "../src/config.js";
import { FhirError, HttpFhirClient } from "../src/fhir/client.js";
import { requestContext } from "../src/security/context.js";
import { createPatientAuthorizer } from "../src/security/patient-policy.js";
import {
  findPatient,
  getPatientSummary,
} from "../src/tools/patient-records.js";

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

  it("skips search outcome entries and keeps the matches", async () => {
    const { fhir } = client([
      {
        resourceType: "Bundle",
        type: "searchset",
        entry: [
          {
            resource: {
              resourceType: "AllergyIntolerance",
              id: "a-1",
              patient: { reference: `Patient/${PATIENT}` },
            },
            search: { mode: "match" },
          },
          {
            resource: {
              resourceType: "OperationOutcome",
              issue: [{ severity: "warning", code: "suppressed" }],
            },
            search: { mode: "outcome" },
          },
        ],
        link: [],
      },
    ]);
    const result = await fhir.getAllergies(PATIENT);
    expect(result.map((r) => r.id)).toEqual(["a-1"]);
  });

  it("refuses an OperationOutcome marked as a match", async () => {
    const { fhir } = client([
      {
        resourceType: "Bundle",
        type: "searchset",
        entry: [
          {
            resource: { resourceType: "OperationOutcome", issue: [] },
            search: { mode: "match" },
          },
        ],
        link: [],
      },
    ]);
    await expect(fhir.getAllergies(PATIENT)).rejects.toBeInstanceOf(FhirError);
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

  it("minimises a Procedure and sends the start date", async () => {
    const { fhir, requests } = client([
      bundle([
        {
          resourceType: "Procedure",
          id: "p-1",
          status: "completed",
          code: concept("80146002"),
          subject: { reference: `Patient/${PATIENT}`, display: "private-name" },
          performedDateTime: "2024-03-01",
          note: [{ text: "private-note" }],
          performer: [{ actor: { display: "private-surgeon" } }],
        },
      ]),
    ]);
    const [procedure] = await fhir.getProcedures(PATIENT, "2024-01-01");
    expect(new URL(requests[0] ?? "").searchParams.get("date")).toBe(
      "ge2024-01-01",
    );
    expect(procedure).toEqual({
      resourceType: "Procedure",
      id: "p-1",
      status: "completed",
      code: {
        coding: [{ system: "http://snomed.info/sct", code: "80146002" }],
      },
      subject: { reference: `Patient/${PATIENT}` },
      performedDateTime: "2024-03-01",
    });
  });

  it("drops the narrative and attachments of a DiagnosticReport", async () => {
    const { fhir } = client([
      bundle([
        {
          resourceType: "DiagnosticReport",
          id: "d-1",
          status: "final",
          code: concept("58410-2"),
          subject: { reference: `Patient/${PATIENT}` },
          issued: "2024-03-02T10:00:00Z",
          result: [{ reference: "Observation/o-1", display: "private-result" }],
          conclusion: "private-conclusion",
          presentedForm: [{ contentType: "text/plain", data: "cHJpdmF0ZQ==" }],
        },
      ]),
    ]);
    const [report] = await fhir.getDiagnosticReports(PATIENT);
    expect(JSON.stringify(report)).not.toContain("private");
    expect(report).not.toHaveProperty("presentedForm");
    expect(report?.result).toEqual([{ reference: "Observation/o-1" }]);
  });

  it.each(["laboratory", "vital-signs"] as const)(
    "searches %s observations by category and date",
    async (category) => {
      const { fhir, requests } = client([
        bundle([
          {
            resourceType: "Observation",
            id: "o-1",
            status: "final",
            code: concept("85354-9"),
            subject: { reference: `Patient/${PATIENT}` },
            interpretation: [concept("H")],
            component: [
              {
                code: concept("8480-6"),
                valueQuantity: { value: 120, unit: "mm[Hg]" },
                valueString: "private-component",
              },
            ],
            note: [{ text: "private-note" }],
          },
        ]),
      ]);
      const [observation] = await fhir.getObservationsByCategory(
        PATIENT,
        category,
        "2024-01-01",
      );
      const sent = new URL(requests[0] ?? "").searchParams;
      expect(sent.get("category")).toBe(category);
      expect(sent.get("date")).toBe("ge2024-01-01");
      expect(sent.get("patient")).toBe(PATIENT);
      expect(JSON.stringify(observation)).not.toContain("private");
      expect(observation?.component?.[0]?.valueQuantity?.value).toBe(120);
    },
  );

  it("returns care team roles without members", async () => {
    const { fhir } = client([
      bundle([
        {
          resourceType: "CareTeam",
          id: "t-1",
          status: "active",
          name: "private-team",
          subject: { reference: `Patient/${PATIENT}` },
          participant: [
            {
              role: [concept("17561000")],
              member: {
                reference: "Practitioner/pr-1",
                display: "private-member",
              },
            },
          ],
        },
      ]),
    ]);
    const [team] = await fhir.getCareTeams(PATIENT);
    expect(JSON.stringify(team)).not.toContain("private");
    expect(JSON.stringify(team)).not.toContain("Practitioner");
    expect(team?.participant?.[0]?.role?.[0]?.coding?.[0]?.code).toBe(
      "17561000",
    );
  });

  it("returns a Goal without its free text", async () => {
    const { fhir } = client([
      bundle([
        {
          resourceType: "Goal",
          id: "g-1",
          lifecycleStatus: "active",
          description: { text: "private-goal" },
          subject: { reference: `Patient/${PATIENT}` },
          target: [{ dueDate: "2025-01-01", detailString: "private-target" }],
          note: [{ text: "private-note" }],
        },
      ]),
    ]);
    const [goal] = await fhir.getGoals(PATIENT);
    expect(JSON.stringify(goal)).not.toContain("private");
    expect(goal?.target).toEqual([{ dueDate: "2025-01-01" }]);
  });

  it.each([
    ["Procedure", { status: "completed" }, "getProcedures"],
    ["DiagnosticReport", { status: "final", code: {} }, "getDiagnosticReports"],
    ["CareTeam", {}, "getCareTeams"],
    ["Goal", { lifecycleStatus: "active", description: {} }, "getGoals"],
  ] as const)(
    "refuses a %s for another patient",
    async (resourceType, fields, method) => {
      const { fhir } = client([
        bundle([
          {
            resourceType,
            id: "x-1",
            ...fields,
            subject: { reference: "Patient/someone-else" },
          },
        ]),
      ]);
      await expect(fhir[method](PATIENT)).rejects.toThrow(
        "Unexpected FHIR subject",
      );
    },
  );

  it("refuses a category observation for another patient", async () => {
    const { fhir } = client([
      bundle([
        {
          resourceType: "Observation",
          id: "o-9",
          status: "final",
          code: {},
          subject: { reference: "Patient/someone-else" },
        },
      ]),
    ]);
    await expect(
      fhir.getObservationsByCategory(PATIENT, "laboratory"),
    ).rejects.toThrow("Unexpected FHIR subject");
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
      findPatients: vi.fn(async () => []),
      getProcedures: vi.fn(async () => []),
      getDiagnosticReports: vi.fn(async () => []),
      getObservationsByCategory: vi.fn(async () => []),
      getCareTeams: vi.fn(async () => []),
      getGoals: vi.fn(async () => []),
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

describe("find_patient", () => {
  const principal = "spiffe://example.org/synthetic-a";
  const config = ConfigSchema.parse({
    AUDIT_HMAC_KEY: "a".repeat(64),
    NODE_ENV: "test",
  });
  function deps(tools: ("find_patient" | "get_patient")[]) {
    const audit = new AuditLogger(config);
    const record = vi.spyOn(audit, "record").mockResolvedValue();
    const fhir = {
      getPatient: vi.fn(),
      searchObservations: vi.fn(),
      getMedicationRequests: vi.fn(),
      getConditions: vi.fn(),
      getAllergies: vi.fn(),
      getImmunizations: vi.fn(),
      getEncounters: vi.fn(),
      findPatients: vi.fn(async () => [
        { resourceType: "Patient" as const, id: PATIENT },
        { resourceType: "Patient" as const, id: "synthetic-outside" },
      ]),
      getProcedures: vi.fn(async () => []),
      getDiagnosticReports: vi.fn(async () => []),
      getObservationsByCategory: vi.fn(async () => []),
      getCareTeams: vi.fn(async () => []),
      getGoals: vi.fn(async () => []),
    };
    return {
      fhir,
      record,
      deps: {
        config,
        audit,
        fhir,
        authorizer: createPatientAuthorizer({
          version: 1,
          grants: [{ principal, patients: [PATIENT], tools }],
        }),
        context: requestContext(principal, "spiffe-mtls+token"),
      },
    };
  }

  it("returns only matches inside the find_patient grant", async () => {
    const { deps: d, record } = deps(["find_patient"]);
    const found = await findPatient(
      { identifier: "urn:sys|synthetic-mrn-secret" },
      d,
    );
    expect(found.map((p) => p.id)).toEqual([PATIENT]);
    expect(record).toHaveBeenCalledOnce();
    expect(JSON.stringify(record.mock.calls[0]?.[0])).not.toContain(
      "synthetic-mrn-secret",
    );
  });

  it("does not search at all without a find_patient grant", async () => {
    const { deps: d, fhir } = deps(["get_patient"]);
    await expect(findPatient({ identifier: "urn:sys|123" }, d)).rejects.toThrow(
      "patient_not_authorized",
    );
    expect(fhir.findPatients).not.toHaveBeenCalled();
  });

  it("searches Patient by identifier without a patient parameter", async () => {
    const { fhir, requests } = client([
      bundle([
        {
          resourceType: "Patient",
          id: PATIENT,
          name: [{ text: "private-name" }],
        },
      ]),
    ]);
    const result = await fhir.findPatients("urn:sys|123");
    const url = new URL(requests[0] ?? "");
    expect(url.pathname).toBe("/fhir/Patient");
    expect(url.searchParams.get("identifier")).toBe("urn:sys|123");
    expect(url.searchParams.has("patient")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-");
  });
});
