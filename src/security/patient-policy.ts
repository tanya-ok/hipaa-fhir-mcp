import { closeSync, openSync, readSync } from "node:fs";
import { z } from "zod";
import { PatientIdSchema } from "../fhir/schemas.js";
import type { RequestContext } from "./context.js";

export const TOOL_NAMES = [
  "get_patient",
  "search_observations",
  "get_medication_list",
  "get_conditions",
  "get_allergies",
  "get_immunizations",
  "get_encounters",
  "get_patient_summary",
  "find_patient",
  "get_procedures",
  "get_diagnostic_reports",
  "get_lab_results",
  "get_vital_signs",
  "get_care_team",
  "get_goals",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const MAX_POLICY_BYTES = 64 * 1024;

export const PatientPolicySchema = z
  .object({
    version: z.literal(1),
    grants: z
      .array(
        z
          .object({
            principal: z.string().min(1).max(256),
            patients: z.array(PatientIdSchema).min(1).max(1000),
            tools: z.array(z.enum(TOOL_NAMES)).min(1),
            expires_at: z.iso.datetime({ offset: true }).optional(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .superRefine((policy, ctx) => {
    const seen = new Set<string>();
    for (const [index, grant] of policy.grants.entries()) {
      if (seen.has(grant.principal)) {
        ctx.addIssue({
          code: "custom",
          path: ["grants", index, "principal"],
          message: "each principal may appear in only one grant",
        });
      }
      seen.add(grant.principal);
    }
  });

export type PatientPolicy = z.infer<typeof PatientPolicySchema>;

export interface PatientAuthorizer {
  authorize(
    context: RequestContext,
    tool: ToolName,
    patientId: string,
  ): boolean;
  /** True when the caller holds this tool for at least one patient. */
  allowsTool(context: RequestContext, tool: ToolName): boolean;
}

/** Used when no policy is configured: every request is refused. */
export const DENY_ALL: PatientAuthorizer = Object.freeze({
  authorize: () => false,
  allowsTool: () => false,
});

/** Exact principal, patient and tool match. No wildcards, no defaults. */
export function createPatientAuthorizer(
  policy: PatientPolicy,
  now: () => number = Date.now,
): PatientAuthorizer {
  const grants = new Map(
    PatientPolicySchema.parse(policy).grants.map((grant) => [
      grant.principal,
      {
        patients: new Set(grant.patients),
        tools: new Set<ToolName>(grant.tools),
        expiresAt:
          grant.expires_at === undefined
            ? undefined
            : Date.parse(grant.expires_at),
      },
    ]),
  );
  // An expired grant is treated as absent; the clock is read on every call.
  const liveGrant = (context: RequestContext) => {
    if (context.provenance === "none" || context.principal === null)
      return undefined;
    const grant = grants.get(context.principal);
    if (grant === undefined) return undefined;
    if (grant.expiresAt !== undefined && !(now() < grant.expiresAt))
      return undefined;
    return grant;
  };
  const authorizer: PatientAuthorizer = {
    authorize(context, tool, patientId) {
      const grant = liveGrant(context);
      if (grant === undefined) return false;
      return grant.tools.has(tool) && grant.patients.has(patientId);
    },
    allowsTool(context, tool) {
      return liveGrant(context)?.tools.has(tool) ?? false;
    },
  };
  return Object.freeze(authorizer);
}

/** One bounded read from one descriptor, so the size check and the content cannot differ. */
function readPolicy(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_POLICY_BYTES + 1);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length > MAX_POLICY_BYTES)
      throw new Error("patient policy file is too large");
    return buffer.toString("utf8", 0, length);
  } finally {
    closeSync(fd);
  }
}

export function loadPatientAuthorizer(
  path: string | undefined,
): PatientAuthorizer {
  if (path === undefined) return DENY_ALL;
  const parsed = PatientPolicySchema.safeParse(JSON.parse(readPolicy(path)));
  if (!parsed.success) throw new Error("patient policy file is invalid");
  return createPatientAuthorizer(parsed.data);
}
