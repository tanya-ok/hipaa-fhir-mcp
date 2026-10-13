import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditInput } from "../audit/logger.js";
import { FhirError } from "../fhir/client.js";
import { PatientIdSchema } from "../fhir/schemas.js";
import type { MedicationRequest } from "../fhir/types.js";
import type { ToolDeps } from "./types.js";

export const GetMedicationListInput = z.object({
  patient_id: PatientIdSchema,
});

export type GetMedicationListInputType = z.infer<typeof GetMedicationListInput>;

export async function getMedicationList(
  input: GetMedicationListInputType,
  deps: ToolDeps,
): Promise<MedicationRequest[]> {
  const base: Omit<AuditInput, "status"> = {
    tool: "get_medication_list",
    patient_id: input.patient_id,
    caller_identity: deps.config.CALLER_IDENTITY,
    request_id: randomUUID(),
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
