#!/usr/bin/env node
import { AuditLogger } from "./audit/logger.js";
import { loadConfig } from "./config.js";
import { HttpFhirClient } from "./fhir/client.js";
import { createFhirMcpServer } from "./mcp.js";
import { NO_CONTEXT, requestContext } from "./security/context.js";
import { loadPatientAuthorizer } from "./security/patient-policy.js";
import { AuditedStdioTransport } from "./stdio.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const deps = {
    config,
    audit: new AuditLogger(config),
    fhir: new HttpFhirClient(config),
    authorizer: loadPatientAuthorizer(config.PATIENT_POLICY_FILE),
  };
  // Standalone stdio has no verified caller; a configured principal is a labelled local fixture.
  const context = config.LOCAL_SYNTHETIC_PRINCIPAL
    ? requestContext(config.LOCAL_SYNTHETIC_PRINCIPAL, "local-synthetic")
    : NO_CONTEXT;
  const server = createFhirMcpServer(deps, () => context);
  await server.connect(new AuditedStdioTransport({ ...deps, context }));
}

function fatal(): never {
  process.stderr.write("fatal: server failed\n");
  process.exit(1);
}
process.on("unhandledRejection", fatal);
process.on("uncaughtException", fatal);
main().catch(fatal);
