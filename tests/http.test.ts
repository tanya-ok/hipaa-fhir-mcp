import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../src/audit/logger.js";
import { ConfigSchema } from "../src/config.js";
import type { FhirClient } from "../src/fhir/client.js";
import {
  createHttpHandler,
  DEMO_PRINCIPAL,
  type HttpAuth,
  loadTokens,
  RateLimiter,
} from "../src/http.js";
import { toolInputSchemas } from "../src/mcp.js";
import { createPatientAuthorizer } from "../src/security/patient-policy.js";

const TOKEN = "synthetic-token-0123456789abcdef";
const PRINCIPAL = "synthetic-operator";
const PATIENT = "synthetic-patient-a";
const dir = mkdtempSync(path.join(tmpdir(), "mcp-http-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))),
  );
});

async function start(
  auth: HttpAuth,
  options: { limit?: number; allowedHosts?: string[] } = {},
) {
  const config = ConfigSchema.parse({
    AUDIT_HMAC_KEY: "a".repeat(64),
    NODE_ENV: "test",
  });
  const audit = new AuditLogger(config);
  const record = vi.spyOn(audit, "record").mockResolvedValue();
  const fhir = {
    getPatient: vi.fn(async (id: string) => ({
      resourceType: "Patient" as const,
      id,
    })),
    searchObservations: vi.fn(async () => []),
    getMedicationRequests: vi.fn(async () => []),
    getConditions: vi.fn(async () => []),
    getAllergies: vi.fn(async () => []),
    getImmunizations: vi.fn(async () => []),
    getEncounters: vi.fn(async () => []),
  } satisfies FhirClient;
  const principal = auth.mode === "demo" ? DEMO_PRINCIPAL : PRINCIPAL;
  const handler = createHttpHandler({
    deps: {
      config,
      audit,
      fhir,
      authorizer: createPatientAuthorizer({
        version: 1,
        grants: [{ principal, patients: [PATIENT], tools: ["get_patient"] }],
      }),
    },
    auth,
    version: "test",
    limiter: new RateLimiter(options.limit ?? 1000, 60_000),
    allowedHosts: options.allowedHosts,
  });
  const server = createServer((req, res) => void handler(req, res));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, fhir, record };
}

const bearer: HttpAuth = {
  mode: "bearer",
  tokens: [
    {
      principal: PRINCIPAL,
      digest: createHash("sha256").update(TOKEN).digest(),
    },
  ],
};

async function connect(base: string, token?: string) {
  const client = new Client({ name: "synthetic-http", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined,
    }),
  );
  return client;
}

const post = (
  base: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body,
  });

describe("HTTP transport with bearer tokens", () => {
  it("serves the health check without a token", async () => {
    const { base } = await start(bearer);
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", mode: "bearer" });
  });

  it("refuses a missing or wrong token before any MCP handling", async () => {
    const { base, record } = await start(bearer);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect((await post(base, body, { Authorization: "" })).status).toBe(401);
    const wrong = await post(base, body, {
      Authorization: "Bearer synthetic-wrong-0123456789",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toContain("Bearer");
    expect(record).not.toHaveBeenCalled();
  });

  it("lists tools and enforces the patient grant for the token's principal", async () => {
    const { base, fhir } = await start(bearer);
    const client = await connect(base, TOKEN);
    try {
      expect((await client.listTools()).tools.length).toBe(
        Object.keys(toolInputSchemas).length,
      );
      const ok = await client.callTool({
        name: "get_patient",
        arguments: { patient_id: PATIENT },
      });
      expect(ok.isError).toBeFalsy();
      const denied = await client.callTool({
        name: "get_patient",
        arguments: { patient_id: "synthetic-patient-b" },
      });
      expect(denied).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Patient access not authorized" }],
      });
      expect(fhir.getPatient).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });

  it("audits and rejects invalid tool arguments", async () => {
    const { base, record, fhir } = await start(bearer);
    const res = await post(
      base,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "get_patient", arguments: { patient_id: "../x" } },
      }),
    );
    expect(await res.json()).toMatchObject({
      id: 7,
      error: { message: "Tool request rejected" },
    });
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      error_code: "invalid_arguments",
      caller_identity: PRINCIPAL,
    });
    expect(fhir.getPatient).not.toHaveBeenCalled();
  });

  it("rejects batches, oversized bodies and other methods", async () => {
    const { base } = await start(bearer);
    expect((await post(base, "[]")).status).toBe(400);
    expect((await post(base, "x".repeat(70 * 1024))).status).toBe(413);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it("rate limits per client address", async () => {
    const { base } = await start(bearer, { limit: 2 });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post(base, body)).status);
    expect(codes[2]).toBe(429);
  });

  it("refuses an unexpected Host header when hosts are pinned", async () => {
    const { base } = await start(bearer, { allowedHosts: ["mcp.example.org"] });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect((await post(base, body)).status).toBe(403);
  });
});

describe("public demo mode", () => {
  it("needs no token and acts only as the demo principal", async () => {
    const { base } = await start({ mode: "demo" });
    const client = await connect(base);
    try {
      const ok = await client.callTool({
        name: "get_patient",
        arguments: { patient_id: PATIENT },
      });
      expect(ok.isError).toBeFalsy();
      const other = await client.callTool({
        name: "get_conditions",
        arguments: { patient_id: PATIENT },
      });
      expect(other.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("token file", () => {
  it("accepts mode 600 with SHA-256 digests and refuses wider modes", () => {
    const file = path.join(dir, "tokens.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        tokens: [
          {
            principal: PRINCIPAL,
            sha256: createHash("sha256").update(TOKEN).digest("hex"),
          },
        ],
      }),
    );
    chmodSync(file, 0o644);
    expect(() => loadTokens(file)).toThrow("mode 600");
    chmodSync(file, 0o600);
    expect(loadTokens(file)[0]?.principal).toBe(PRINCIPAL);
  });
});
