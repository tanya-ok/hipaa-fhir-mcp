import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditInput } from "../audit/logger.js";
import { FhirError } from "../fhir/client.js";
import { PatientIdSchema } from "../fhir/schemas.js";
import type { Patient } from "../fhir/types.js";
import type { ToolDeps } from "./types.js";

export const GetPatientInput = z.object({
  patient_id: PatientIdSchema,
});

export type GetPatientInputType = z.infer<typeof GetPatientInput>;

export async function getPatient(
  input: GetPatientInputType,
  deps: ToolDeps,
): Promise<Patient> {
  const base: Omit<AuditInput, "status"> = {
    tool: "get_patient",
    patient_id: input.patient_id,
    caller_identity: deps.config.CALLER_IDENTITY,
    request_id: randomUUID(),
  };

  try {
    const patient = await deps.fhir.getPatient(input.patient_id);
    await deps.audit.record({ ...base, status: "success" });
    return patient;
  } catch (err) {
    await deps.audit.record({
      ...base,
      status: "error",
      error_code: errorCode(err),
    });
    throw err;
  }
}

function errorCode(err: unknown): string {
  if (err instanceof FhirError && err.statusCode !== undefined) {
    return `fhir_${err.statusCode}`;
  }
  return "internal_error";
}
