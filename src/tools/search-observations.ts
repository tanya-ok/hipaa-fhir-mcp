import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { AuditInput } from "../audit/logger.js";
import { FhirError } from "../fhir/client.js";
import type { Observation } from "../fhir/types.js";
import type { ToolDeps } from "./types.js";

export const SearchObservationsInput = z.object({
  patient_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9\-.]+$/, {
      message: "patient_id must match FHIR id syntax",
    }),
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
    request_id: uuidv4(),
  };

  try {
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
      error_code:
        err instanceof FhirError && err.statusCode !== undefined
          ? `fhir_${err.statusCode}`
          : "internal_error",
    });
    throw err;
  }
}
