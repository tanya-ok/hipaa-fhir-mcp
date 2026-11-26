#!/usr/bin/env node
// Seeds the local Medplum lab: one regular project, one SMART Backend Services
// client bound to your JWKS URL, and one synthetic patient with one resource
// per tool. Writes lab.json and patient-policy.json next to this file.
// Usage: JWKS_URL=https://<host>/jwks.json NODE_EXTRA_CA_CERTS=caddy-root.crt node seed.mjs
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = process.env.MEDPLUM_BASE_URL ?? "https://localhost:8443";
const JWKS = process.env.JWKS_URL;
if (!JWKS) {
  process.stderr.write("Set JWKS_URL to the HTTPS URL of your public JWKS.\n");
  process.exit(2);
}

async function call(method, path, body, token, form = false) {
  const headers = {};
  if (body)
    headers["Content-Type"] = form
      ? "application/x-www-form-urlencoded"
      : "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body && (form ? new URLSearchParams(body) : JSON.stringify(body)),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed with ${res.status}`);
  return res.json();
}

// A throwaway lab account; the password is random and never stored.
const verifier = randomBytes(32).toString("hex");
const user = await call("POST", "/auth/newuser", {
  firstName: "Lab",
  lastName: "Operator",
  email: `lab-${randomBytes(4).toString("hex")}@example.com`,
  password: randomBytes(24).toString("base64url"),
  codeChallengeMethod: "plain",
  codeChallenge: verifier,
});
// SMART scopes are refused in Medplum's super admin project, so use a regular one.
const project = await call("POST", "/auth/newproject", {
  login: user.login,
  projectName: "hipaa-fhir-mcp-lab",
});
const { access_token: admin } = await call(
  "POST",
  "/oauth2/token",
  {
    grant_type: "authorization_code",
    code: project.code,
    code_verifier: verifier,
  },
  undefined,
  true,
);
const me = await call("GET", "/auth/me", undefined, admin);

const created = await call(
  "POST",
  `/admin/projects/${me.project.id}/client`,
  { name: "hipaa-fhir-mcp-smoke" },
  admin,
);
const client = await call(
  "PUT",
  `/fhir/R4/ClientApplication/${created.id}`,
  { ...created, jwksUri: JWKS },
  admin,
);

const fhir = (resource) =>
  call("POST", `/fhir/R4/${resource.resourceType}`, resource, admin);
const code = (system, value, display) => ({
  coding: [{ system, code: value, display }],
});
const hl7 = "http://terminology.hl7.org/CodeSystem";
const identifier = {
  system: "urn:example:hipaa-fhir-mcp:lab",
  value: "SYN-0001",
};

const patient = await fhir({
  resourceType: "Patient",
  identifier: [identifier],
  name: [{ family: "Synthetic", given: ["Lab"] }],
  gender: "female",
  birthDate: "1980-01-01",
});
const subject = { reference: `Patient/${patient.id}` };
await fhir({
  resourceType: "Observation",
  status: "final",
  category: [code(`${hl7}/observation-category`, "vital-signs")],
  code: code("http://loinc.org", "8867-4", "Heart rate"),
  subject,
  effectiveDateTime: "2026-11-01T10:00:00Z",
  valueQuantity: {
    value: 72,
    unit: "/min",
    system: "http://unitsofmeasure.org",
    code: "/min",
  },
});
await fhir({
  resourceType: "Condition",
  clinicalStatus: code(`${hl7}/condition-clinical`, "active"),
  verificationStatus: code(`${hl7}/condition-ver-status`, "confirmed"),
  code: code("http://snomed.info/sct", "38341003", "Hypertensive disorder"),
  subject,
  onsetDateTime: "2020-05-01",
});
await fhir({
  resourceType: "AllergyIntolerance",
  clinicalStatus: code(`${hl7}/allergyintolerance-clinical`, "active"),
  verificationStatus: code(
    `${hl7}/allergyintolerance-verification`,
    "confirmed",
  ),
  code: code("http://snomed.info/sct", "91936005", "Allergy to penicillin"),
  patient: subject,
});
await fhir({
  resourceType: "MedicationRequest",
  status: "active",
  intent: "order",
  medicationCodeableConcept: code(
    "http://www.nlm.nih.gov/research/umls/rxnorm",
    "314076",
    "lisinopril 10 MG Oral Tablet",
  ),
  subject,
  authoredOn: "2026-10-01",
});
await fhir({
  resourceType: "Immunization",
  status: "completed",
  vaccineCode: code(
    "http://hl7.org/fhir/sid/cvx",
    "140",
    "Influenza, seasonal",
  ),
  patient: subject,
  occurrenceDateTime: "2026-10-15",
});
await fhir({
  resourceType: "Encounter",
  status: "finished",
  class: { system: `${hl7}/v3-ActCode`, code: "AMB" },
  subject,
  period: { start: "2026-10-15T09:00:00Z", end: "2026-10-15T09:30:00Z" },
});

// Only well-formed FHIR ids from the server reach the files written below.
function fhirId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9.-]{1,64}$/.test(value))
    throw new Error("Server returned a malformed id");
  return value;
}
const clientId = fhirId(client.id);
const patientId = fhirId(patient.id);

const lab = await fhir({
  resourceType: "Observation",
  status: "final",
  category: [code(`${hl7}/observation-category`, "laboratory")],
  code: code("http://loinc.org", "2345-7", "Glucose"),
  subject,
  effectiveDateTime: "2026-11-01T08:00:00Z",
  valueQuantity: {
    value: 95,
    unit: "mg/dL",
    system: "http://unitsofmeasure.org",
    code: "mg/dL",
  },
});
await fhir({
  resourceType: "DiagnosticReport",
  status: "final",
  category: [code(`${hl7}/v2-0074`, "LAB")],
  code: code("http://loinc.org", "24323-8", "Comprehensive metabolic panel"),
  subject,
  effectiveDateTime: "2026-11-01T08:00:00Z",
  result: [{ reference: `Observation/${lab.id}` }],
});
await fhir({
  resourceType: "Procedure",
  status: "completed",
  code: code("http://snomed.info/sct", "80146002", "Appendectomy"),
  subject,
  performedDateTime: "2015-06-01",
});
await fhir({
  resourceType: "CareTeam",
  status: "active",
  subject,
  participant: [
    {
      role: [
        code("http://snomed.info/sct", "446050000", "Primary care physician"),
      ],
    },
  ],
});
await fhir({
  resourceType: "Goal",
  lifecycleStatus: "active",
  description: code(
    "http://snomed.info/sct",
    "135840009",
    "Blood pressure monitoring",
  ),
  subject,
  startDate: "2026-10-01",
});

const here = (name) => new URL(`./${name}`, import.meta.url);
writeFileSync(
  here("lab.json"),
  `${JSON.stringify(
    {
      clientId,
      patientId,
      identifier: `${identifier.system}|${identifier.value}`,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  here("patient-policy.json"),
  `${JSON.stringify(
    {
      version: 1,
      grants: [
        {
          principal: "local-synthetic-operator",
          patients: [patientId],
          tools: [
            "get_patient",
            "get_patient_summary",
            "search_observations",
            "get_medication_list",
            "get_conditions",
            "get_allergies",
            "get_immunizations",
            "get_encounters",
            "find_patient",
            "get_procedures",
            "get_diagnostic_reports",
            "get_lab_results",
            "get_vital_signs",
            "get_care_team",
            "get_goals",
          ],
        },
      ],
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`client ${clientId}`);
console.log(`patient ${patientId}`);
