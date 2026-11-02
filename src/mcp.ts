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
        "Fetch a FHIR R4 Patient resource by id. Emits an audit record with a hashed patient id - no PHI is ever logged.",
      inputSchema: GetPatientInput.shape,
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
        "Search FHIR R4 Observations for a patient by code (e.g. `http://loinc.org|8867-4`). Returns an array of Observation resources.",
      inputSchema: SearchObservationsInput.shape,
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
        "Fetch active MedicationRequest resources for a patient. Returns an array of MedicationRequest resources.",
      inputSchema: GetMedicationListInput.shape,
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
