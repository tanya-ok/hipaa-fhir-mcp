import { z } from "zod";

const ConfigSchema = z.object({
  FHIR_BASE_URL: z
    .string()
    .url()
    .default("https://r4.smarthealthit.org"),
  FHIR_AUTH_TOKEN: z.string().min(1).optional(),
  CALLER_IDENTITY: z.string().min(1).default("anonymous-dev"),
  AUDIT_LOG_FILE: z.string().min(1).optional(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.flatten().fieldErrors;
    process.stderr.write(
      `config: invalid environment\n${JSON.stringify(issues, null, 2)}\n`,
    );
    process.exit(1);
  }
  return result.data;
}
