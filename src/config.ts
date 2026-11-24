import { z } from "zod";

const blankIsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const httpsUrl = z.url().refine((value) => {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}, "must be an HTTPS URL without credentials, query or fragment");

export const DEFAULT_SMART_SCOPE = [
  "Patient",
  "Observation",
  "MedicationRequest",
  "Condition",
  "AllergyIntolerance",
  "Immunization",
  "Encounter",
]
  .map((type) => `system/${type}.rs`)
  .join(" ");

export const ConfigSchema = z
  .object({
    FHIR_BASE_URL: z
      .url()
      .refine((value) => {
        const url = URL.parse(value);
        return (
          url !== null &&
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }, "FHIR_BASE_URL must be an HTTPS base URL without credentials, query or fragment")
      .optional(),
    FHIR_AUTH_TOKEN: z.string().min(1).optional(),
    SMART_CLIENT_ID: blankIsUnset(z.string().min(1).max(2048).optional()),
    SMART_KEY_ID: blankIsUnset(z.string().min(1).max(256).optional()),
    SMART_PRIVATE_KEY_FILE: blankIsUnset(z.string().min(1).optional()),
    SMART_SCOPE: blankIsUnset(
      z
        .string()
        .regex(/^system\/[A-Za-z*]+\.[a-z]+( system\/[A-Za-z*]+\.[a-z]+)*$/, {
          message:
            "SMART_SCOPE must be space-separated system scopes, for example system/Patient.rs",
        })
        .default(DEFAULT_SMART_SCOPE),
    ),
    SMART_TOKEN_URL: blankIsUnset(httpsUrl.optional()),
    CALLER_IDENTITY: z.string().min(1).default("anonymous-dev"),
    PATIENT_POLICY_FILE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    LOCAL_SYNTHETIC_PRINCIPAL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).max(256).optional(),
    ),
    AUDIT_LOG_FILE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    AUDIT_HMAC_KEY: z.string().regex(/^[0-9a-f]{64}$/i, {
      message:
        "AUDIT_HMAC_KEY must be exactly 64 hex characters. Generate one with: openssl rand -hex 32",
    }),
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  })
  .superRefine((config, ctx) => {
    if (
      config.NODE_ENV === "production" &&
      /^(.)\1*$/i.test(config.AUDIT_HMAC_KEY)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUDIT_HMAC_KEY"],
        message:
          "AUDIT_HMAC_KEY must not repeat one character in production. Generate one with: openssl rand -hex 32",
      });
    }
    const smart = [
      config.SMART_CLIENT_ID,
      config.SMART_KEY_ID,
      config.SMART_PRIVATE_KEY_FILE,
    ];
    if (smart.some(Boolean) && !smart.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["SMART_CLIENT_ID"],
        message:
          "SMART Backend Services needs SMART_CLIENT_ID, SMART_KEY_ID and SMART_PRIVATE_KEY_FILE together",
      });
    }
    if (smart.some(Boolean) && config.FHIR_AUTH_TOKEN !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["FHIR_AUTH_TOKEN"],
        message:
          "Use either FHIR_AUTH_TOKEN or SMART Backend Services, not both",
      });
    }
    if (smart.some(Boolean) && !config.FHIR_BASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["FHIR_BASE_URL"],
        message: "FHIR_BASE_URL is required with SMART Backend Services",
      });
    }
    if (
      !config.FHIR_BASE_URL &&
      (config.NODE_ENV === undefined ||
        config.NODE_ENV === "production" ||
        config.FHIR_AUTH_TOKEN !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["FHIR_BASE_URL"],
        message:
          "FHIR_BASE_URL is required unless development/test is explicit and no backend token is configured",
      });
    }
  })
  .transform((config) => ({
    ...config,
    NODE_ENV: config.NODE_ENV ?? "development",
    FHIR_BASE_URL: config.FHIR_BASE_URL ?? "https://r4.smarthealthit.org",
  }));

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = z.flattenError(result.error).fieldErrors;
    process.stderr.write(
      `config: invalid environment\n${JSON.stringify(issues, null, 2)}\n`,
    );
    process.exit(1);
  }
  return result.data;
}
