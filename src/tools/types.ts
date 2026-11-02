import type { AuditLogger } from "../audit/logger.js";
import type { Config } from "../config.js";
import type { FhirClient } from "../fhir/client.js";
import type { RequestContext } from "../security/context.js";
import type { PatientAuthorizer } from "../security/patient-policy.js";

export interface ToolDeps {
  fhir: FhirClient;
  audit: AuditLogger;
  config: Config;
  authorizer: PatientAuthorizer;
  context: RequestContext;
}
