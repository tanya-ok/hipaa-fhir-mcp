import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9.-]{1,64}$/);

export const PatientIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(?!\.{1,2}$)[A-Za-z0-9.-]+$/, {
    message: "patient_id must match FHIR id syntax",
  });
const text = z.string().min(1).max(256);
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

export const MAX_RESULTS = 200;
export const MAX_PAGES = 5;
export const PAGE_SIZE = 50;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

export const SearchBundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  type: z.literal("searchset"),
  total: z.number().int().nonnegative().optional(),
  entry: z
    .array(z.object({ resource: z.unknown() }))
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
