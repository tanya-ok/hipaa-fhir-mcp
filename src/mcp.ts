import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

function toErrorResult(): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: "text", text: "FHIR request failed" }],
    isError: true,
  };
}

export const toolInputSchemas = {
  get_patient: GetPatientInput,
  search_observations: SearchObservationsInput,
  get_medication_list: GetMedicationListInput,
};

/** The caller provider is trusted transport context, never a client header. */
export function createFhirMcpServer(
  deps: ToolDeps,
  callerIdentity: () => string = () => deps.config.CALLER_IDENTITY,
): McpServer {
  const requestDeps = (): ToolDeps => ({
    ...deps,
    config: { ...deps.config, CALLER_IDENTITY: callerIdentity() },
  });
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
      } catch {
        return toErrorResult();
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
      } catch {
        return toErrorResult();
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
      } catch {
        return toErrorResult();
      }
    },
  );

  return server;
}
