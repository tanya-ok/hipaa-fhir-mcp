import { z } from "zod";

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
    CALLER_IDENTITY: z.string().min(1).default("anonymous-dev"),
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
