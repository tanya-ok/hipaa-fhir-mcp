import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PatientIdSchema, SinceDateSchema } from "../fhir/schemas.js";
import type { ToolName } from "../security/patient-policy.js";
import { errorCode, requirePatientAccess } from "./access.js";
import type { ToolDeps } from "./types.js";

export const PatientRecordInput = z.object({ patient_id: PatientIdSchema });
export const GetEncountersInput = z.object({
  patient_id: PatientIdSchema,
  since: SinceDateSchema.optional(),
});

type PatientRecordInputType = z.infer<typeof PatientRecordInput>;
type GetEncountersInputType = z.infer<typeof GetEncountersInput>;

/** Access check first, then the read, then exactly one audit record. */
async function audited<T>(
  deps: ToolDeps,
  tool: ToolName,
  patientId: string,
  read: () => Promise<T>,
): Promise<T> {
  const base = {
    tool,
    patient_id: patientId,
    caller_identity: deps.config.CALLER_IDENTITY,
    request_id: randomUUID(),
  };
  try {
    requirePatientAccess(deps, tool, patientId);
    const result = await read();
    await deps.audit.record({ ...base, status: "success" });
    return result;
  } catch (err) {
    await deps.audit.record({
      ...base,
      status: "error",
      error_code: errorCode(err),
    });
    throw err;
  }
}

export const getConditions = (input: PatientRecordInputType, deps: ToolDeps) =>
  audited(deps, "get_conditions", input.patient_id, () =>
    deps.fhir.getConditions(input.patient_id),
  );

export const getAllergies = (input: PatientRecordInputType, deps: ToolDeps) =>
  audited(deps, "get_allergies", input.patient_id, () =>
    deps.fhir.getAllergies(input.patient_id),
  );

export const getImmunizations = (
  input: PatientRecordInputType,
  deps: ToolDeps,
) =>
  audited(deps, "get_immunizations", input.patient_id, () =>
    deps.fhir.getImmunizations(input.patient_id),
  );

export const getEncounters = (input: GetEncountersInputType, deps: ToolDeps) =>
  audited(deps, "get_encounters", input.patient_id, () =>
    deps.fhir.getEncounters(input.patient_id, input.since),
  );

const ACTIVE = "active";
const isActive = (status?: { coding?: { code?: string }[] }) =>
  status?.coding?.some((c) => c.code === ACTIVE) ?? false;

/** One grant and one audit record for the whole summary; any failed read fails it. */
export const getPatientSummary = (
  input: PatientRecordInputType,
  deps: ToolDeps,
) =>
  audited(deps, "get_patient_summary", input.patient_id, async () => {
    const id = input.patient_id;
    const [patient, conditions, allergies, medications] = await Promise.all([
      deps.fhir.getPatient(id),
      deps.fhir.getConditions(id),
      deps.fhir.getAllergies(id),
      deps.fhir.getMedicationRequests(id),
    ]);
    return {
      patient,
      active_conditions: conditions.filter((c) => isActive(c.clinicalStatus)),
      allergies: allergies.filter(
        (a) => !a.clinicalStatus || isActive(a.clinicalStatus),
      ),
      active_medications: medications,
    };
  });
