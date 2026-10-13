#!/usr/bin/env node
import { AuditLogger } from "./audit/logger.js";
import { loadConfig } from "./config.js";
import { HttpFhirClient } from "./fhir/client.js";
import { createFhirMcpServer } from "./mcp.js";
import { AuditedStdioTransport } from "./stdio.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const deps = {
    config,
    audit: new AuditLogger(config),
    fhir: new HttpFhirClient(config),
  };
  const server = createFhirMcpServer(deps);
  await server.connect(new AuditedStdioTransport(deps));
}

function fatal(): never {
  process.stderr.write("fatal: server failed\n");
  process.exit(1);
}
process.on("unhandledRejection", fatal);
process.on("uncaughtException", fatal);
main().catch(fatal);
