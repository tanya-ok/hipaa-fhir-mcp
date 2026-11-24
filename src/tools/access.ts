import { FhirError } from "../fhir/client.js";
import type { ToolName } from "../security/patient-policy.js";
import type { ToolDeps } from "./types.js";

export class PatientAccessDenied extends Error {
  constructor() {
    super("patient_not_authorized");
    this.name = "PatientAccessDenied";
  }
}

/** Must run before any FHIR request, inside the tool's audited block. */
export function requirePatientAccess(
  deps: ToolDeps,
  tool: ToolName,
  patientId: string,
): void {
  if (!deps.authorizer.authorize(deps.context, tool, patientId))
    throw new PatientAccessDenied();
}

export function errorCode(err: unknown): string {
  if (err instanceof PatientAccessDenied) return "patient_not_authorized";
  if (err instanceof FhirError && err.statusCode !== undefined)
    return `fhir_${err.statusCode}`;
  return "internal_error";
}
