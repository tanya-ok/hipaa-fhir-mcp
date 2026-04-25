import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { type AuditInput, hashPatientId } from "../audit/logger.js";
import { FhirError } from "../fhir/client.js";
import type { MedicationRequest } from "../fhir/types.js";
import type { ToolDeps } from "./types.js";

export const GetMedicationListInput = z.object({
  patient_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9\-.]+$/, {
      message: "patient_id must match FHIR id syntax",
    }),
});

export type GetMedicationListInputType = z.infer<
  typeof GetMedicationListInput
>;

export async function getMedicationList(
  input: GetMedicationListInputType,
  deps: ToolDeps,
): Promise<MedicationRequest[]> {
  const base: Omit<AuditInput, "status"> = {
    tool: "get_medication_list",
    patient_id_hash: hashPatientId(input.patient_id),
    caller_identity: deps.config.CALLER_IDENTITY,
    request_id: uuidv4(),
  };

  try {
    const meds = await deps.fhir.getMedicationRequests(input.patient_id);
    await deps.audit.record({ ...base, status: "success" });
    return meds;
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
