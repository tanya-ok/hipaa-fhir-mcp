#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { z } from "zod";
import { AuditLogger } from "./audit/logger.js";
import { loadConfig } from "./config.js";
import { HttpFhirClient } from "./fhir/client.js";
import {
  createHttpHandler,
  DEMO_FHIR_BASE,
  type HttpAuth,
  loadTokens,
  RateLimiter,
} from "./http.js";
import { loadPatientAuthorizer } from "./security/patient-policy.js";

const HttpEnvSchema = z.object({
  MCP_HTTP_HOST: z.string().min(1).default("127.0.0.1"),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  MCP_HTTP_TOKENS_FILE: z.string().min(1).optional(),
  MCP_DEMO: z.enum(["0", "1"]).default("0"),
  MCP_ALLOWED_HOSTS: z.string().min(1).optional(),
  MCP_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(60),
});

function fail(message: string): never {
  process.stderr.write(`config: ${message}\n`);
  process.exit(1);
}

function main(): void {
  const config = loadConfig();
  const env = HttpEnvSchema.safeParse(process.env);
  if (!env.success) fail("invalid MCP_HTTP_* settings");
  const http = env.data;
  const demo = http.MCP_DEMO === "1";
  if (demo === Boolean(http.MCP_HTTP_TOKENS_FILE))
    fail("set exactly one of MCP_HTTP_TOKENS_FILE or MCP_DEMO=1");
  if (!config.PATIENT_POLICY_FILE)
    fail("PATIENT_POLICY_FILE is required; without it every call is denied");
  // The public demo can only ever reach the synthetic sandbox, with no backend credential.
  if (
    demo &&
    (config.FHIR_BASE_URL.replace(/\/+$/, "") !== DEMO_FHIR_BASE ||
      config.FHIR_AUTH_TOKEN ||
      process.env.SMART_CLIENT_ID)
  )
    fail(
      `MCP_DEMO=1 requires FHIR_BASE_URL=${DEMO_FHIR_BASE} and no backend credentials`,
    );
  let auth: HttpAuth;
  try {
    auth = demo
      ? { mode: "demo" }
      : { mode: "bearer", tokens: loadTokens(http.MCP_HTTP_TOKENS_FILE ?? "") };
  } catch {
    fail(
      "MCP_HTTP_TOKENS_FILE could not be loaded (mode 600, schema version 1)",
    );
  }
  const { version } = z
    .object({ version: z.string() })
    .parse(
      JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ),
    );
  const handler = createHttpHandler({
    deps: {
      config,
      audit: new AuditLogger(config),
      fhir: new HttpFhirClient(config),
      authorizer: loadPatientAuthorizer(config.PATIENT_POLICY_FILE),
    },
    auth,
    version,
    limiter: new RateLimiter(http.MCP_RATE_LIMIT_PER_MINUTE, 60_000),
    allowedHosts: http.MCP_ALLOWED_HOSTS?.split(",").map((h) =>
      h.trim().toLowerCase(),
    ),
  });
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent)
        res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"error":"internal_error"}');
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.listen(http.MCP_HTTP_PORT, http.MCP_HTTP_HOST, () => {
    process.stderr.write(
      `hipaa-fhir-mcp ${version} listening on ${http.MCP_HTTP_HOST}:${http.MCP_HTTP_PORT} (${auth.mode})\n`,
    );
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main();
