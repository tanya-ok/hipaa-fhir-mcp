// Streamable HTTP transport (stateless). Every request is authenticated with a bearer
// token mapped to a policy principal, or runs in a public demo bound to synthetic data.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createFhirMcpServer, toolInputSchemas } from "./mcp.js";
import {
  NO_CONTEXT,
  type RequestContext,
  requestContext,
} from "./security/context.js";
import type { ToolDeps } from "./tools/types.js";

export const MAX_BODY_BYTES = 64 * 1024;
export const DEMO_FHIR_BASE = "https://r4.smarthealthit.org";
export const DEMO_PRINCIPAL = "public-demo";

const TokensSchema = z
  .object({
    version: z.literal(1),
    tokens: z
      .array(
        z
          .object({
            principal: z.string().min(1).max(256),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();

export interface BearerToken {
  principal: string;
  digest: Buffer;
}

/** Token file holds only SHA-256 digests; it must not be readable by group or others. */
export function loadTokens(path: string): BearerToken[] {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077)
      throw new Error(
        "MCP_HTTP_TOKENS_FILE must be a regular file with mode 600",
      );
    const parsed = TokensSchema.parse(JSON.parse(readFileSync(fd, "utf8")));
    return parsed.tokens.map((t) => ({
      principal: t.principal,
      digest: Buffer.from(t.sha256, "hex"),
    }));
  } finally {
    closeSync(fd);
  }
}

export type HttpAuth =
  | { mode: "bearer"; tokens: BearerToken[] }
  | { mode: "demo" };

export function authenticate(
  auth: HttpAuth,
  header: string | undefined,
): RequestContext {
  if (auth.mode === "demo")
    return requestContext(DEMO_PRINCIPAL, "public-demo");
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{16,512})$/.exec(header ?? "");
  if (!match?.[1]) return NO_CONTEXT;
  const digest = createHash("sha256").update(match[1]).digest();
  // Compare against every entry so timing does not reveal which one matched.
  let found: string | null = null;
  for (const token of auth.tokens)
    if (timingSafeEqual(digest, token.digest)) found ??= token.principal;
  return found ? requestContext(found, "http-bearer") : NO_CONTEXT;
}

/** Fixed-window limiter per client key; enough to keep a public demo usable. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}
  allow(key: string): boolean {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || t - entry.start >= this.windowMs) {
      this.hits.delete(key);
      // Insertion order is window start order: drop expired keys, then the oldest if full.
      for (const [other, seen] of this.hits) {
        if (t - seen.start < this.windowMs && this.hits.size < this.maxKeys)
          break;
        this.hits.delete(other);
      }
      this.hits.set(key, { start: t, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string): void {
  json(res, status, {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32600, message },
  });
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface HttpOptions {
  deps: Omit<ToolDeps, "context">;
  auth: HttpAuth;
  version: string;
  limiter: RateLimiter;
  allowedHosts?: readonly string[];
  /** Header a trusted proxy sets to the client address, for example Fly-Client-IP. */
  clientIpHeader?: string;
}

export function createHttpHandler(options: HttpOptions) {
  const { deps, auth, version, limiter } = options;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/healthz" && req.method === "GET") {
      json(res, 200, { status: "ok", version, mode: auth.mode });
      return;
    }
    if (path !== "/mcp") {
      json(res, 404, { error: "not_found" });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      json(res, 405, { error: "method_not_allowed" });
      return;
    }
    const host = (req.headers.host ?? "").toLowerCase();
    if (options.allowedHosts && !options.allowedHosts.includes(host)) {
      json(res, 403, { error: "host_not_allowed" });
      return;
    }
    const forwarded = options.clientIpHeader
      ? req.headers[options.clientIpHeader.toLowerCase()]
      : undefined;
    const client =
      (typeof forwarded === "string" && forwarded.slice(0, 64)) ||
      req.socket.remoteAddress ||
      "unknown";
    if (!limiter.allow(client)) {
      res.setHeader("Retry-After", "60");
      json(res, 429, { error: "rate_limited" });
      return;
    }
    const context = authenticate(auth, req.headers.authorization);
    if (context === NO_CONTEXT) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="hipaa-fhir-mcp"');
      json(res, 401, { error: "unauthorized" });
      return;
    }
    const raw = await readBody(req);
    if (raw === null) {
      rpcError(res, 413, "Request body too large");
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      rpcError(res, 400, "Invalid JSON");
      return;
    }
    if (Array.isArray(body)) {
      rpcError(res, 400, "Batch requests are not supported");
      return;
    }
    // Invalid tool calls are audited here, as the stdio transport does, before the SDK rejects them.
    const call = CallToolRequestSchema.safeParse(body);
    if (call.success) {
      const name = call.data.params.name;
      const schema = Object.hasOwn(toolInputSchemas, name)
        ? toolInputSchemas[name as keyof typeof toolInputSchemas]
        : undefined;
      if (!schema?.safeParse(call.data.params.arguments ?? {}).success) {
        await deps.audit.record({
          tool: schema ? name : "unknown_tool",
          patient_id: "invalid-input",
          caller_identity: context.principal ?? "unauthenticated",
          request_id: randomUUID(),
          status: "error",
          error_code: schema ? "invalid_arguments" : "unknown_tool",
        });
        json(res, 200, {
          jsonrpc: "2.0",
          id: (body as { id?: unknown }).id ?? null,
          error: { code: -32602, message: "Tool request rejected" },
        });
        return;
      }
    }
    const server = createFhirMcpServer(deps, () => context);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}
