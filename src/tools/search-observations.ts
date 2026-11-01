import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditInput } from "../audit/logger.js";
import { PatientIdSchema } from "../fhir/schemas.js";
import type { Observation } from "../fhir/types.js";
import { errorCode, requirePatientAccess } from "./access.js";
import type { ToolDeps } from "./types.js";

export const SearchObservationsInput = z.object({
  patient_id: PatientIdSchema,
  code: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[\w\-.|,:%/]+$/, {
      message:
        "code must be a token search expression (e.g. http://loinc.org|8867-4)",
    }),
});

export type SearchObservationsInputType = z.infer<
  typeof SearchObservationsInput
>;

export async function searchObservations(
  input: SearchObservationsInputType,
  deps: ToolDeps,
): Promise<Observation[]> {
  const base: Omit<AuditInput, "status"> = {
    tool: "search_observations",
    patient_id: input.patient_id,
    caller_identity: deps.config.CALLER_IDENTITY,
    request_id: randomUUID(),
  };

  try {
    requirePatientAccess(deps, "search_observations", input.patient_id);
    const observations = await deps.fhir.searchObservations(
      input.patient_id,
      input.code,
    );
    await deps.audit.record({ ...base, status: "success" });
    return observations;
  } catch (err) {
    await deps.audit.record({
      ...base,
      status: "error",
      error_code: errorCode(err),
    });
    throw err;
  }
}
