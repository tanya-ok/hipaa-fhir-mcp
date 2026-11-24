import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../src/audit/logger.js";
import { ConfigSchema } from "../src/config.js";
import type { FhirClient } from "../src/fhir/client.js";
import { createFhirMcpServer } from "../src/mcp.js";
import {
  NO_CONTEXT,
  type RequestContext,
  requestContext,
} from "../src/security/context.js";
import {
  createPatientAuthorizer,
  DENY_ALL,
  loadPatientAuthorizer,
  type PatientAuthorizer,
  TOOL_NAMES,
} from "../src/security/patient-policy.js";
import { getMedicationList } from "../src/tools/get-medication-list.js";
import { getPatient } from "../src/tools/get-patient.js";
import { searchObservations } from "../src/tools/search-observations.js";
import type { ToolDeps } from "../src/tools/types.js";

const A = "spiffe://example.org/synthetic-a";
const B = "spiffe://example.org/synthetic-b";
const PATIENT_A = "synthetic-patient-a";
const PATIENT_B = "synthetic-patient-b";

const policy = {
  version: 1 as const,
  grants: [
    { principal: A, patients: [PATIENT_A], tools: [...TOOL_NAMES] },
    { principal: B, patients: [PATIENT_B], tools: ["get_patient" as const] },
  ],
};

function harness(
  context: RequestContext,
  authorizer: PatientAuthorizer = createPatientAuthorizer(policy),
) {
  const config = ConfigSchema.parse({
    AUDIT_HMAC_KEY: "a".repeat(64),
    NODE_ENV: "test",
    CALLER_IDENTITY: "synthetic-label",
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
  } satisfies FhirClient;
  const deps: ToolDeps = { config, audit, fhir, authorizer, context };
  return { deps, fhir, record };
}

const tools = [
  {
    name: "get_patient",
    run: (deps: ToolDeps, patient_id: string) =>
      getPatient({ patient_id }, deps),
    upstream: "getPatient",
  },
  {
    name: "search_observations",
    run: (deps: ToolDeps, patient_id: string) =>
      searchObservations({ patient_id, code: "8867-4" }, deps),
    upstream: "searchObservations",
  },
  {
    name: "get_medication_list",
    run: (deps: ToolDeps, patient_id: string) =>
      getMedicationList({ patient_id }, deps),
    upstream: "getMedicationRequests",
  },
] as const;

describe.each(tools)("$name authorization", ({ name, run, upstream }) => {
  const verifiedA = requestContext(A, "spiffe-mtls+token");

  it("allows the granted patient with one FHIR call and one success record", async () => {
    const { deps, fhir, record } = harness(verifiedA);
    await run(deps, PATIENT_A);
    expect(fhir[upstream]).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      tool: name,
      status: "success",
    });
  });

  it("denies another patient before dispatch with one audit record", async () => {
    const { deps, fhir, record } = harness(verifiedA);
    await expect(run(deps, PATIENT_B)).rejects.toThrow(
      "patient_not_authorized",
    );
    expect(fhir[upstream]).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      tool: name,
      status: "error",
      error_code: "patient_not_authorized",
    });
  });

  it.each([
    ["no verified identity", NO_CONTEXT],
    [
      "unknown principal",
      requestContext("spiffe://x/other", "local-synthetic"),
    ],
  ])("denies %s before dispatch", async (_label, context) => {
    const { deps, fhir } = harness(context);
    await expect(run(deps, PATIENT_A)).rejects.toThrow(
      "patient_not_authorized",
    );
    expect(fhir[upstream]).not.toHaveBeenCalled();
  });

  it("denies everything without a policy", async () => {
    const { deps, fhir } = harness(verifiedA, DENY_ALL);
    await expect(run(deps, PATIENT_A)).rejects.toThrow(
      "patient_not_authorized",
    );
    expect(fhir[upstream]).not.toHaveBeenCalled();
  });
});

describe("tool grants", () => {
  it("denies an allowed patient through a tool outside the grant", async () => {
    const { deps, fhir } = harness(requestContext(B, "spiffe-mtls+token"));
    await getPatient({ patient_id: PATIENT_B }, deps);
    await expect(
      getMedicationList({ patient_id: PATIENT_B }, deps),
    ).rejects.toThrow("patient_not_authorized");
    expect(fhir.getMedicationRequests).not.toHaveBeenCalled();
  });

  it("does not treat a null principal as a match even with a local provenance", () => {
    const authorizer = createPatientAuthorizer(policy);
    expect(
      authorizer.authorize(
        { principal: null, provenance: "local-synthetic" },
        "get_patient",
        PATIENT_A,
      ),
    ).toBe(false);
    expect(requestContext("", "local-synthetic")).toBe(NO_CONTEXT);
  });
});

async function connect(
  deps: Omit<ToolDeps, "context">,
  context: () => RequestContext,
) {
  const server = createFhirMcpServer(deps, context);
  const client = new Client({ name: "synthetic-policy", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP boundary", () => {
  it("ignores identity and grant claims in tool arguments and metadata", async () => {
    const { deps, fhir } = harness(requestContext(B, "spiffe-mtls+token"));
    const { client, server } = await connect(deps, () => deps.context);
    try {
      const result = await client.callTool({
        name: "get_patient",
        arguments: {
          patient_id: PATIENT_A,
          principal: A,
          caller_identity: A,
          grants: [{ principal: B, patients: [PATIENT_A] }],
        },
        _meta: { principal: A, provenance: "spiffe-mtls+token" },
      });
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Patient access not authorized" }],
      });
      expect(fhir.getPatient).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps concurrent callers with different grants separate", async () => {
    const { deps, fhir, record } = harness(NO_CONTEXT);
    const sessions = await Promise.all(
      [A, B].map((principal) =>
        connect(deps, () => requestContext(principal, "spiffe-mtls+token")),
      ),
    );
    try {
      const [a, b, aDenied, bDenied] = await Promise.all([
        sessions[0]?.client.callTool({
          name: "get_patient",
          arguments: { patient_id: PATIENT_A },
        }),
        sessions[1]?.client.callTool({
          name: "get_patient",
          arguments: { patient_id: PATIENT_B },
        }),
        sessions[0]?.client.callTool({
          name: "get_patient",
          arguments: { patient_id: PATIENT_B },
        }),
        sessions[1]?.client.callTool({
          name: "get_patient",
          arguments: { patient_id: PATIENT_A },
        }),
      ]);
      expect(a?.isError).not.toBe(true);
      expect(b?.isError).not.toBe(true);
      expect(aDenied?.isError).toBe(true);
      expect(bDenied?.isError).toBe(true);
      expect(fhir.getPatient).toHaveBeenCalledTimes(2);
      const entries = record.mock.calls.map(([entry]) => entry);
      expect(entries).toHaveLength(4);
      for (const entry of entries) {
        const own = entry.caller_identity === A ? PATIENT_A : PATIENT_B;
        expect(entry.status).toBe(
          entry.patient_id === own ? "success" : "error",
        );
      }
    } finally {
      await Promise.all(
        sessions.flatMap((s) =>
          s ? [s.client.close(), s.server.close()] : [],
        ),
      );
    }
  });

  it("returns the fixed FHIR error for an allowed call that fails upstream", async () => {
    const { deps, fhir } = harness(requestContext(A, "spiffe-mtls+token"));
    fhir.getPatient.mockRejectedValueOnce(new Error("synthetic-private-text"));
    const { client, server } = await connect(deps, () => deps.context);
    try {
      const result = await client.callTool({
        name: "get_patient",
        arguments: { patient_id: PATIENT_A },
      });
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "FHIR request failed" }],
      });
      expect(JSON.stringify(result)).not.toContain("synthetic-private-text");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("policy loading", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hipaa-policy-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, body: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    return file;
  };

  it("denies by default when no file is configured", () => {
    expect(loadPatientAuthorizer(undefined)).toBe(DENY_ALL);
  });

  it("loads a valid policy with exact matching", () => {
    const authorizer = loadPatientAuthorizer(
      write("ok.json", JSON.stringify(policy)),
    );
    const context = requestContext(A, "local-synthetic");
    expect(authorizer.authorize(context, "get_patient", PATIENT_A)).toBe(true);
    expect(authorizer.authorize(context, "get_patient", PATIENT_B)).toBe(false);
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["wrong version", JSON.stringify({ ...policy, version: 2 })],
    ["unknown top-level key", JSON.stringify({ ...policy, allow_all: true })],
    [
      "wildcard patient",
      JSON.stringify({
        version: 1,
        grants: [{ principal: A, patients: ["*"], tools: ["get_patient"] }],
      }),
    ],
    [
      "unknown tool",
      JSON.stringify({
        version: 1,
        grants: [{ principal: A, patients: [PATIENT_A], tools: ["*"] }],
      }),
    ],
    [
      "duplicate principal",
      JSON.stringify({
        version: 1,
        grants: [policy.grants[0], policy.grants[0]],
      }),
    ],
  ])("rejects %s", (name, body) => {
    expect(() =>
      loadPatientAuthorizer(write(`${name.replace(/ /g, "-")}.json`, body)),
    ).toThrow();
  });

  it("rejects a missing or oversized file", () => {
    expect(() =>
      loadPatientAuthorizer(path.join(dir, "absent.json")),
    ).toThrow();
    expect(() =>
      loadPatientAuthorizer(write("big.json", " ".repeat(64 * 1024 + 1))),
    ).toThrow("too large");
  });
});
