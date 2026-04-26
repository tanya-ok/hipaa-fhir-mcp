#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuditLogger } from "./audit/logger.js";
import { loadConfig } from "./config.js";
import { HttpFhirClient } from "./fhir/client.js";
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

function toTextResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function toErrorResult(err: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const audit = new AuditLogger(config);
  const fhir = new HttpFhirClient(config);
  const deps: ToolDeps = { config, audit, fhir };

  const server = new McpServer({
    name: "hipaa-fhir-mcp",
    version: "0.1.0",
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
        const patient = await getPatient(input, deps);
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
        const observations = await searchObservations(input, deps);
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
        const meds = await getMedicationList(input, deps);
        return toTextResult(meds);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

process.on("unhandledRejection", (reason) => {
  process.stderr.write(
    `fatal: unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`,
  );
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(
    `fatal: uncaught exception: ${err.stack ?? err.message}\n`,
  );
  process.exit(1);
});

main().catch((err) => {
  process.stderr.write(
    `fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
