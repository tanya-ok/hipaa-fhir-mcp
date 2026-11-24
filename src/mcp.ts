import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FhirError } from "./fhir/client.js";
import type { RequestContext } from "./security/context.js";
import { PatientAccessDenied } from "./tools/access.js";
import {
  GetMedicationListInput,
  getMedicationList,
} from "./tools/get-medication-list.js";
import { GetPatientInput, getPatient } from "./tools/get-patient.js";
import {
  FindPatientInput,
  findPatient,
  GetEncountersInput,
  getAllergies,
  getConditions,
  getEncounters,
  getImmunizations,
  getPatientSummary,
  PatientRecordInput,
} from "./tools/patient-records.js";
import {
  SearchObservationsInput,
  searchObservations,
} from "./tools/search-observations.js";
import type { ToolDeps } from "./tools/types.js";

const { version } = z
  .object({ version: z.string().min(1) })
  .parse(
    JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ),
  );

function toTextResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function toErrorResult(err?: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const text =
    err instanceof PatientAccessDenied
      ? "Patient access not authorized"
      : err instanceof FhirError && err.message === "FHIR result limit exceeded"
        ? "Too many results (more than 200); narrow the request"
        : "FHIR request failed";
  return { content: [{ type: "text", text }], isError: true };
}

export const toolInputSchemas = {
  get_patient: GetPatientInput,
  search_observations: SearchObservationsInput,
  get_medication_list: GetMedicationListInput,
  get_conditions: PatientRecordInput,
  get_allergies: PatientRecordInput,
  get_immunizations: PatientRecordInput,
  get_encounters: GetEncountersInput,
  get_patient_summary: PatientRecordInput,
  find_patient: FindPatientInput,
};

/**
 * The context provider is trusted transport state, never a client header or
 * tool argument. CALLER_IDENTITY stays an audit label when no principal is
 * verified.
 */
export function createFhirMcpServer(
  deps: Omit<ToolDeps, "context">,
  context: () => RequestContext,
): McpServer {
  const requestDeps = (): ToolDeps => {
    const current = context();
    return {
      ...deps,
      context: current,
      config: {
        ...deps.config,
        CALLER_IDENTITY: current.principal ?? deps.config.CALLER_IDENTITY,
      },
    };
  };
  const server = new McpServer({
    name: "hipaa-fhir-mcp",
    version,
  });

  server.registerTool(
    "get_patient",
    {
      title: "Get FHIR Patient",
      description:
        'Read one FHIR R4 Patient resource by its logical id from the configured FHIR server (by default the public synthetic SMART sandbox). Use it first to confirm a patient exists and to get gender, birth date and active status; use search_observations or get_medication_list for clinical data. Read only. Returns the Patient as JSON with only id, active, gender and birthDate. Every call writes one audit record in which the patient id is HMAC-hashed; no PHI is logged. Other failures return the fixed text "FHIR request failed" with no server detail. Access is checked first against the server patient policy: a patient outside the caller grant returns "Patient access not authorized" before any FHIR request.',
      inputSchema: GetPatientInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const patient = await getPatient(input, requestDeps());
        return toTextResult(patient);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "search_observations",
    {
      title: "Search FHIR Observations",
      description:
        'Search FHIR R4 Observation resources for one patient filtered by a code, for example vital signs or lab results. Use it when you know the code to look for (LOINC is typical: http://loinc.org|8867-4 is heart rate); use get_patient to check the patient first. Read only. Returns a JSON array of Observations with status, code, subject, effective or issued time and the value, at most 200 results across up to 5 pages of 50; larger result sets fail instead of being truncated. Every call writes one hashed audit record. Other failures return the fixed text "FHIR request failed" with no server detail. Access is checked first against the server patient policy: a patient outside the caller grant returns "Patient access not authorized" before any FHIR request.',
      inputSchema: SearchObservationsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const observations = await searchObservations(input, requestDeps());
        return toTextResult(observations);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "get_medication_list",
    {
      title: "Get Medication List",
      description:
        'List the active FHIR R4 MedicationRequest resources for one patient. Use it to see what is currently prescribed; inactive, stopped and completed requests are excluded. Read only. Returns a JSON array of MedicationRequests with status, intent, subject, the medication code or reference and authoredOn, at most 200 results. Every call writes one hashed audit record. Other failures return the fixed text "FHIR request failed" with no server detail. Access is checked first against the server patient policy: a patient outside the caller grant returns "Patient access not authorized" before any FHIR request.',
      inputSchema: GetMedicationListInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const meds = await getMedicationList(input, requestDeps());
        return toTextResult(meds);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "get_conditions",
    {
      title: "Get Conditions",
      description:
        'List FHIR R4 Condition resources (problems and diagnoses) for one patient, active and resolved. Use it to see what the patient is or was treated for; check clinicalStatus for active. Returns a JSON array with clinical and verification status, code (system and code only; display and free text are dropped), onset, abatement and recorded dates. Read only. Every call writes one audit record in which the patient id is HMAC-hashed; no PHI is logged. Access is checked first against the server patient policy: a patient outside the caller grant returns "Patient access not authorized" before any FHIR request. More than 200 results returns "Too many results (more than 200); narrow the request". Other failures return "FHIR request failed" with no server detail.',
      inputSchema: PatientRecordInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return toTextResult(await getConditions(input, requestDeps()));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "get_allergies",
    {
      title: "Get Allergies",
      description:
        'List FHIR R4 AllergyIntolerance resources for one patient. Use it before reasoning about medications. Returns a JSON array with clinical status, type, category, criticality, the substance code (system and code only; display and free text are dropped) and recorded date. Read only. Every call writes one audit record in which the patient id is HMAC-hashed; no PHI is logged. Access is checked first against the server patient policy: a patient outside the caller grant returns "Patient access not authorized" before any FHIR request. More than 200 results returns "Too many results (more than 200); narrow the request". Other failures return "FHIR request failed" with no server detail.',
      inputSchema: PatientRecordInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return toTextResult(await getAllergies(input, requestDeps()));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "get_immunizations",
    {
      title: "Get Immunizations",
      description:
        'List FHIR R4 Immunization resources for one patient. Returns a JSON array with status, vaccine code (system and code only; display and free text are dropped) and the date given. Read only. Every call writes one audit record in which the patient id is HMAC-hashed; no PHI is logged. Access is checked first against the server patient policy: a patient outside the caller grant returns "Patient access not authorized" before any FHIR request. More than 200 results returns "Too many results (more than 200); narrow the request". Other failures return "FHIR request failed" with no server detail.',
      inputSchema: PatientRecordInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return toTextResult(await getImmunizations(input, requestDeps()));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "get_encounters",
    {
      title: "Get Encounters",
      description:
        'List FHIR R4 Encounter resources (visits and admissions) for one patient. Pass since (YYYY-MM-DD) for patients with a long history. Returns a JSON array with status, class, type and period. Read only. Every call writes one audit record in which the patient id is HMAC-hashed; no PHI is logged. Access is checked first against the server patient policy: a patient outside the caller grant returns "Patient access not authorized" before any FHIR request. More than 200 results returns "Too many results (more than 200); narrow the request". Other failures return "FHIR request failed" with no server detail.',
      inputSchema: GetEncountersInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return toTextResult(await getEncounters(input, requestDeps()));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "get_patient_summary",
    {
      title: "Get Patient Summary",
      description:
        'One-call overview of a patient: demographics, active conditions, allergies and active medications. Use it first when asked about a patient as a whole; use the single-resource tools for detail or history. Needs its own policy grant. Any failed part fails the whole summary. Read only. Every call writes one audit record in which the patient id is HMAC-hashed; no PHI is logged. Access is checked first against the server patient policy: a patient outside the caller grant returns "Patient access not authorized" before any FHIR request. More than 200 results returns "Too many results (more than 200); narrow the request". Other failures return "FHIR request failed" with no server detail.',
      inputSchema: PatientRecordInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return toTextResult(await getPatientSummary(input, requestDeps()));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "find_patient",
    {
      title: "Find Patient by Identifier",
      description:
        'Find patients by identifier (MRN, member id or another system|value) and return their FHIR ids, gender, birth date and active status. Use it when you know an identifier but not the FHIR id, then pass the id to the other tools. Only patients the caller is granted for find_patient are returned; others are silently left out, so an empty list does not mean no such patient exists. Read only. Every call writes one audit record; the identifier and patient ids are not logged. A caller without a find_patient grant gets "Patient access not authorized" before any FHIR request. More than 200 matches returns "Too many results (more than 200); narrow the request". Other failures return "FHIR request failed" with no server detail.',
      inputSchema: FindPatientInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return toTextResult(await findPatient(input, requestDeps()));
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  return server;
}
