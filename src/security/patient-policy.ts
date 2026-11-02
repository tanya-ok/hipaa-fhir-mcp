import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { PatientIdSchema } from "../fhir/schemas.js";
import type { RequestContext } from "./context.js";

export const TOOL_NAMES = [
  "get_patient",
  "search_observations",
  "get_medication_list",
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
}

/** Used when no policy is configured: every request is refused. */
export const DENY_ALL: PatientAuthorizer = Object.freeze({
  authorize: () => false,
});

/** Exact principal, patient and tool match. No wildcards, no defaults. */
export function createPatientAuthorizer(
  policy: PatientPolicy,
): PatientAuthorizer {
  const grants = new Map(
    PatientPolicySchema.parse(policy).grants.map((grant) => [
      grant.principal,
      {
        patients: new Set(grant.patients),
        tools: new Set<ToolName>(grant.tools),
      },
    ]),
  );
  const authorizer: PatientAuthorizer = {
    authorize(context, tool, patientId) {
      if (context.provenance === "none" || context.principal === null)
        return false;
      const grant = grants.get(context.principal);
      if (grant === undefined) return false;
      return grant.tools.has(tool) && grant.patients.has(patientId);
    },
  };
  return Object.freeze(authorizer);
}

export function loadPatientAuthorizer(
  path: string | undefined,
): PatientAuthorizer {
  if (path === undefined) return DENY_ALL;
  if (statSync(path).size > MAX_POLICY_BYTES)
    throw new Error("patient policy file is too large");
  const parsed = PatientPolicySchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (!parsed.success) throw new Error("patient policy file is invalid");
  return createPatientAuthorizer(parsed.data);
}
