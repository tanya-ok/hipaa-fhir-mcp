import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  IdentifierSearchSchema,
  PatientIdSchema,
  RecordsSinceSchema,
  SinceDateSchema,
} from "../fhir/schemas.js";
import type { ToolName } from "../security/patient-policy.js";
import {
  errorCode,
  PatientAccessDenied,
  requirePatientAccess,
} from "./access.js";
import type { ToolDeps } from "./types.js";

export const PatientRecordInput = z.object({ patient_id: PatientIdSchema });
export const GetEncountersInput = z.object({
  patient_id: PatientIdSchema,
  since: SinceDateSchema.optional(),
});

export const RecordsSinceInput = z.object({
  patient_id: PatientIdSchema,
  since: RecordsSinceSchema.optional(),
});

export const FindPatientInput = z.object({
  identifier: IdentifierSearchSchema,
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

type RecordsSinceInputType = z.infer<typeof RecordsSinceInput>;

export const getProcedures = (input: RecordsSinceInputType, deps: ToolDeps) =>
  audited(deps, "get_procedures", input.patient_id, () =>
    deps.fhir.getProcedures(input.patient_id, input.since),
  );

export const getDiagnosticReports = (
  input: RecordsSinceInputType,
  deps: ToolDeps,
) =>
  audited(deps, "get_diagnostic_reports", input.patient_id, () =>
    deps.fhir.getDiagnosticReports(input.patient_id, input.since),
  );

export const getLabResults = (input: RecordsSinceInputType, deps: ToolDeps) =>
  audited(deps, "get_lab_results", input.patient_id, () =>
    deps.fhir.getObservationsByCategory(
      input.patient_id,
      "laboratory",
      input.since,
    ),
  );

export const getVitalSigns = (input: RecordsSinceInputType, deps: ToolDeps) =>
  audited(deps, "get_vital_signs", input.patient_id, () =>
    deps.fhir.getObservationsByCategory(
      input.patient_id,
      "vital-signs",
      input.since,
    ),
  );

export const getCareTeam = (input: PatientRecordInputType, deps: ToolDeps) =>
  audited(deps, "get_care_team", input.patient_id, () =>
    deps.fhir.getCareTeams(input.patient_id),
  );

export const getGoals = (input: PatientRecordInputType, deps: ToolDeps) =>
  audited(deps, "get_goals", input.patient_id, () =>
    deps.fhir.getGoals(input.patient_id),
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

/**
 * Returns only matches the caller may open with find_patient, so a search never
 * reveals that a patient outside the grant exists. One audit record per search.
 */
export async function findPatient(
  input: z.infer<typeof FindPatientInput>,
  deps: ToolDeps,
) {
  const base = {
    tool: "find_patient",
    patient_id: "identifier-search",
    caller_identity: deps.config.CALLER_IDENTITY,
    request_id: randomUUID(),
  };
  try {
    if (!deps.authorizer.allowsTool(deps.context, "find_patient"))
      throw new PatientAccessDenied();
    const matches = await deps.fhir.findPatients(input.identifier);
    const granted = matches.filter((p) =>
      deps.authorizer.authorize(deps.context, "find_patient", p.id),
    );
    await deps.audit.record({ ...base, status: "success" });
    return granted;
  } catch (err) {
    await deps.audit.record({
      ...base,
      status: "error",
      error_code: errorCode(err),
    });
    throw err;
  }
}
