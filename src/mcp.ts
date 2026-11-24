import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RequestContext } from "./security/context.js";
import { PatientAccessDenied } from "./tools/access.js";
import {
  GetMedicationListInput,
  getMedicationList,
} from "./tools/get-medication-list.js";
import { GetPatientInput, getPatient } from "./tools/get-patient.js";
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
      : "FHIR request failed";
  return { content: [{ type: "text", text }], isError: true };
}

export const toolInputSchemas = {
  get_patient: GetPatientInput,
  search_observations: SearchObservationsInput,
  get_medication_list: GetMedicationListInput,
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

  return server;
}
