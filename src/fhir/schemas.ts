import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9.-]{1,64}$/);

export const PatientIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(?!\.{1,2}$)[A-Za-z0-9.-]+$/, {
    message: "patient_id must match FHIR id syntax",
  })
  .describe(
    "FHIR logical id of the Patient, 1 to 64 letters, digits, dots or hyphens, for example a sandbox id returned by the FHIR server. Not a name, MRN or other identifier.",
  );
const text = z.string().min(1).max(256);
// Display and free text are dropped: they can carry patient-specific narrative.
const coding = z.object({ system: text.optional(), code: text.optional() });
const concept = z.object({ coding: z.array(coding).max(32).optional() });
const reference = z.object({ reference: z.string().min(1).max(2048) });
const quantity = z.object({
  value: z.number().finite().optional(),
  unit: text.optional(),
  system: text.optional(),
  code: text.optional(),
});

export const PatientSchema = z.object({
  resourceType: z.literal("Patient"),
  id,
  active: z.boolean().optional(),
  gender: z.enum(["male", "female", "other", "unknown"]).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
    .optional(),
});

export const ObservationSchema = z.object({
  resourceType: z.literal("Observation"),
  id,
  status: z.enum([
    "registered",
    "preliminary",
    "final",
    "amended",
    "corrected",
    "cancelled",
    "entered-in-error",
    "unknown",
  ]),
  code: concept,
  subject: reference,
  effectiveDateTime: text.optional(),
  issued: text.optional(),
  valueQuantity: quantity.optional(),
  valueCodeableConcept: concept.optional(),
  interpretation: z.array(concept).max(8).optional(),
  // Panels such as blood pressure carry their values here.
  component: z
    .array(
      z.object({
        code: concept,
        valueQuantity: quantity.optional(),
        valueCodeableConcept: concept.optional(),
      }),
    )
    .max(32)
    .optional(),
});

export const MedicationRequestSchema = z.object({
  resourceType: z.literal("MedicationRequest"),
  id,
  status: z.enum([
    "active",
    "on-hold",
    "cancelled",
    "completed",
    "entered-in-error",
    "stopped",
    "draft",
    "unknown",
  ]),
  intent: z.enum([
    "proposal",
    "plan",
    "order",
    "original-order",
    "reflex-order",
    "filler-order",
    "instance-order",
    "option",
  ]),
  subject: reference,
  medicationCodeableConcept: concept.optional(),
  medicationReference: reference.optional(),
  authoredOn: text.optional(),
});

// Only the fields an agent needs are kept; zod drops everything else (minimum necessary).
export const ConditionSchema = z.object({
  resourceType: z.literal("Condition"),
  id,
  clinicalStatus: concept.optional(),
  verificationStatus: concept.optional(),
  code: concept.optional(),
  subject: reference,
  onsetDateTime: text.optional(),
  abatementDateTime: text.optional(),
  recordedDate: text.optional(),
});

export const AllergyIntoleranceSchema = z.object({
  resourceType: z.literal("AllergyIntolerance"),
  id,
  clinicalStatus: concept.optional(),
  verificationStatus: concept.optional(),
  type: z.enum(["allergy", "intolerance"]).optional(),
  category: z
    .array(z.enum(["food", "medication", "environment", "biologic"]))
    .max(4)
    .optional(),
  criticality: z.enum(["low", "high", "unable-to-assess"]).optional(),
  code: concept.optional(),
  patient: reference,
  recordedDate: text.optional(),
});

export const ImmunizationSchema = z.object({
  resourceType: z.literal("Immunization"),
  id,
  status: z.enum(["completed", "entered-in-error", "not-done"]),
  vaccineCode: concept,
  patient: reference,
  occurrenceDateTime: text.optional(),
});

export const EncounterSchema = z.object({
  resourceType: z.literal("Encounter"),
  id,
  status: z.enum([
    "planned",
    "arrived",
    "triaged",
    "in-progress",
    "onleave",
    "finished",
    "cancelled",
    "entered-in-error",
    "unknown",
  ]),
  class: coding.optional(),
  type: z.array(concept).max(8).optional(),
  subject: reference,
  period: z.object({ start: text.optional(), end: text.optional() }).optional(),
});

const period = z.object({ start: text.optional(), end: text.optional() });

export const ProcedureSchema = z.object({
  resourceType: z.literal("Procedure"),
  id,
  status: z.enum([
    "preparation",
    "in-progress",
    "not-done",
    "on-hold",
    "stopped",
    "completed",
    "entered-in-error",
    "unknown",
  ]),
  category: concept.optional(),
  code: concept.optional(),
  subject: reference,
  performedDateTime: text.optional(),
  performedPeriod: period.optional(),
});

// The narrative conclusion and attached documents are dropped; coded results stay.
export const DiagnosticReportSchema = z.object({
  resourceType: z.literal("DiagnosticReport"),
  id,
  status: z.enum([
    "registered",
    "partial",
    "preliminary",
    "final",
    "amended",
    "corrected",
    "appended",
    "cancelled",
    "entered-in-error",
    "unknown",
  ]),
  category: z.array(concept).max(8).optional(),
  code: concept,
  subject: reference,
  effectiveDateTime: text.optional(),
  effectivePeriod: period.optional(),
  issued: text.optional(),
  result: z.array(reference).max(200).optional(),
  conclusionCode: z.array(concept).max(32).optional(),
});

// Members are left out: they name people and organizations. Roles stay.
export const CareTeamSchema = z.object({
  resourceType: z.literal("CareTeam"),
  id,
  status: z
    .enum(["proposed", "active", "suspended", "inactive", "entered-in-error"])
    .optional(),
  category: z.array(concept).max(8).optional(),
  subject: reference,
  period: period.optional(),
  participant: z
    .array(z.object({ role: z.array(concept).max(8).optional() }))
    .max(64)
    .optional(),
});

export const GoalSchema = z.object({
  resourceType: z.literal("Goal"),
  id,
  lifecycleStatus: z.enum([
    "proposed",
    "planned",
    "accepted",
    "active",
    "on-hold",
    "completed",
    "cancelled",
    "entered-in-error",
    "rejected",
  ]),
  achievementStatus: concept.optional(),
  category: z.array(concept).max(8).optional(),
  // Coded goals only: a goal written as free text comes back without a code.
  description: concept,
  subject: reference,
  startDate: text.optional(),
  target: z
    .array(
      z.object({
        measure: concept.optional(),
        detailQuantity: quantity.optional(),
        dueDate: text.optional(),
      }),
    )
    .max(16)
    .optional(),
});

export type Procedure = z.infer<typeof ProcedureSchema>;
export type DiagnosticReport = z.infer<typeof DiagnosticReportSchema>;
export type CareTeam = z.infer<typeof CareTeamSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type AllergyIntolerance = z.infer<typeof AllergyIntoleranceSchema>;
export type Immunization = z.infer<typeof ImmunizationSchema>;
export type Encounter = z.infer<typeof EncounterSchema>;

export const IdentifierSearchSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\w\-.:%/]+\|[\w\-.:%/]+$|^[\w\-.:%/]+$/, {
    message: "identifier must be system|value or value",
  })
  .describe(
    "Patient identifier to look up, as system|value (for example urn:oid:1.2.36.146.595.217.0.1|12345) or a bare value. Only patients in your grant are returned.",
  );

export const SinceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "since must be YYYY-MM-DD" })
  .describe(
    "Optional start date, YYYY-MM-DD. Only encounters on or after this date are returned; use it when a patient has a long history.",
  );

export const RecordsSinceSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "since must be YYYY-MM-DD" })
  .describe(
    "Optional start date, YYYY-MM-DD. Only records dated on or after this date are returned; use it when a patient has a long history.",
  );

export const MAX_RESULTS = 200;
export const MAX_PAGES = 5;
export const PAGE_SIZE = 50;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

export const SearchBundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  type: z.literal("searchset"),
  total: z.number().int().nonnegative().optional(),
  entry: z
    .array(
      z.object({
        resource: z.unknown(),
        search: z.object({ mode: z.string().max(32).optional() }).optional(),
      }),
    )
    .max(MAX_RESULTS)
    .default([]),
  link: z
    .array(
      z.object({
        relation: text,
        url: z.string().min(1).max(4096),
      }),
    )
    .max(32)
    .default([]),
});
