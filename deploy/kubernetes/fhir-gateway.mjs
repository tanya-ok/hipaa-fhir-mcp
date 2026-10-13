// Shared lab gateway, not standalone: runs only inside the mcp-svid-auth Kubernetes lab image,
// which supplies /bridge, /fhir and the sibling ./token-verifier.mjs from mcp-svid-auth.
import { randomBytes, randomUUID } from "node:crypto";
import {
  createMcpSpiffeBridge,
  getCallerIdentity,
} from "/bridge/dist/index.js";
import { AuditLogger } from "/fhir/dist/audit/logger.js";
import { ConfigSchema } from "/fhir/dist/config.js";
import { createFhirMcpServer, toolInputSchemas } from "/fhir/dist/mcp.js";
import { Client } from "/fhir/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { InMemoryTransport } from "/fhir/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import { StreamableHTTPServerTransport } from "/fhir/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js";
import { z } from "/fhir/node_modules/zod/index.js";
import {
  fetchIssuerKeys,
  requireToolScopes,
  verifyAccessToken,
} from "./token-verifier.mjs";

const resource = "https://fhir.security-lab.svc.cluster.local:8443/mcp";
const issuer = "http://authz:8100";
const research = "spiffe://example.org/agent/research";
const config = ConfigSchema.parse({
  FHIR_BASE_URL: "https://synthetic.example.org/fhir",
  CALLER_IDENTITY: "unavailable",
  AUDIT_HMAC_KEY: randomBytes(32).toString("hex"),
  NODE_ENV: "production",
});
const audit = new AuditLogger(config);
// Explicit offline fixture, never an implementation of the production FHIR adapter.
const fixture = {
  async getPatient(id) {
    return { resourceType: "Patient", id, active: true };
  },
  async searchObservations() {
    return [
      {
        resourceType: "Observation",
        id: "synthetic-observation",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "8867-4" }] },
      },
    ];
  },
  async getMedicationRequests(id) {
    return [
      {
        resourceType: "MedicationRequest",
        id: "synthetic-medication",
        status: "active",
        intent: "order",
        subject: { reference: `Patient/${id}` },
      },
    ];
  },
};
const envelope = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.enum([
    "initialize",
    "notifications/initialized",
    "ping",
    "tools/list",
    "tools/call",
  ]),
  params: z.record(z.unknown()).optional(),
});
const toolCall = z.object({
  name: z.enum(["get_patient", "search_observations", "get_medication_list"]),
  arguments: z.record(z.unknown()),
});
const jwksSchema = z.object({
  keys: z.array(
    z.object({
      kty: z.literal("EC"),
      crv: z.literal("P-256"),
      kid: z.string(),
      x: z.string(),
      y: z.string(),
      alg: z.literal("ES256").optional(),
      use: z.literal("sig").optional(),
    }),
  ),
});
let keys;
let loadedAt = 0;
async function loadKeys(refresh = false) {
  if (keys && !refresh && Date.now() - loadedAt < 30_000) return keys;
  // Fixed local issuer only. Incoming bearer credentials are never forwarded.
  keys = jwksSchema.parse(await fetchIssuerKeys(issuer));
  loadedAt = Date.now();
  return keys;
}
function deny(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error }));
}
const toolScopes = {
  get_patient: "fhir:read",
  search_observations: "fhir:read",
  get_medication_list: "fhir:read",
};
async function checkRegisteredScopes() {
  const server = createFhirMcpServer({ config, audit, fhir: fixture });
  const client = new Client({ name: "scope-check", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    requireToolScopes(
      (await client.listTools()).tools.map((tool) => tool.name),
      toolScopes,
    );
  } finally {
    await client.close();
    await server.close();
  }
}
await checkRegisteredScopes();
const bridge = createMcpSpiffeBridge({
  workloadApi: {
    socketPath: "/run/spire/sockets/agent.sock",
    rpcTimeoutMs: 30000,
  },
  validator: {
    allowedCallers: [research],
    allowedTrustDomains: ["example.org"],
    minTtlSeconds: 5,
  },
  transport: { mode: "mtls-server", sse: { host: "0.0.0.0", port: 8443 } },
  audit: {
    logger: {
      log(event) {
        const safe =
          event.event_type === "auth_failure"
            ? {
                ...event,
                caller_spiffe_id: null,
                caller_trust_domain: null,
                denial_reason: "authentication_denied",
              }
            : event;
        process.stderr.write(`${JSON.stringify(safe)}\n`);
      },
    },
  },
  degrade: { mode: "fail-fast" },
});
bridge.setAuthorizedHandler(async (req, res, identity) => {
  if (
    req.method === "GET" &&
    req.url === "/.well-known/oauth-protected-resource/mcp"
  ) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        resource,
        authorization_servers: [issuer],
        scopes_supported: ["fhir:read"],
      }),
    );
    return;
  }
  if (req.method !== "POST" || req.url !== "/mcp") {
    deny(res, 404, "not_found");
    return;
  }
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    deny(res, 401, "invalid_token");
    return;
  }
  const options = { issuer, resource, caller: identity.spiffeId.full };
  let claims;
  try {
    try {
      claims = verifyAccessToken(auth.slice(7), await loadKeys(), options);
    } catch {
      claims = verifyAccessToken(auth.slice(7), await loadKeys(true), options);
    }
  } catch (err) {
    deny(
      res,
      err?.message === "insufficient_scope" ? 403 : 401,
      err?.message === "insufficient_scope"
        ? "insufficient_scope"
        : "invalid_token",
    );
    return;
  }
  let body;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1048576) {
      deny(res, 413, "request_too_large");
      return;
    }
    chunks.push(chunk);
  }
  try {
    body = envelope.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    deny(res, 400, "invalid_request");
    return;
  }
  if (body.method === "tools/call") {
    const call = toolCall.safeParse(body.params);
    if (!call.success) {
      deny(res, 400, "invalid_request");
      return;
    }
    if (
      !toolInputSchemas[call.data.name].safeParse(call.data.arguments).success
    ) {
      await audit.record({
        tool: call.data.name,
        patient_id: "invalid-input",
        caller_identity: identity.spiffeId.full,
        request_id: randomUUID(),
        status: "error",
        error_code: "invalid_arguments",
      });
      deny(res, 400, "invalid_request");
      return;
    }
  }
  // Recheck expiry after reading the request, before any FHIR operation.
  if (
    claims.exp <= Date.now() / 1000 ||
    identity.notAfter.getTime() <= Date.now()
  ) {
    deny(res, 401, "invalid_token");
    return;
  }
  await bridge.fetcher.getX509Svid();
  const server = createFhirMcpServer({ config, audit, fhir: fixture }, () => {
    const caller = getCallerIdentity();
    if (!caller || caller.spiffeId.full !== identity.spiffeId.full)
      throw new Error("caller_unavailable");
    return caller.spiffeId.full;
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
});
function fatal() {
  process.stderr.write("gateway: service unavailable\n");
  process.exit(1);
}
process.on("unhandledRejection", fatal);
process.on("uncaughtException", fatal);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void bridge
      .stop()
      .then(() => process.exit(0))
      .catch(fatal);
  });
await bridge.start();
// Kubernetes replaces the process after a lost credential stream; serving fails closed.
setInterval(() => {
  void bridge.fetcher.getX509Svid().catch(fatal);
}, 1000).unref();
process.stderr.write("gateway: ready; synthetic fixture only\n");
