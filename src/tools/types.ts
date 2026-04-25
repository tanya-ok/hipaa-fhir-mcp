import type { AuditLogger } from "../audit/logger.js";
import type { Config } from "../config.js";
import type { FhirClient } from "../fhir/client.js";

export interface ToolDeps {
  fhir: FhirClient;
  audit: AuditLogger;
  config: Config;
}
