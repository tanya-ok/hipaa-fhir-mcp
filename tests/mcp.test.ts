import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../src/audit/logger.js";
import { ConfigSchema } from "../src/config.js";
import type { FhirClient } from "../src/fhir/client.js";
import { createFhirMcpServer, toolInputSchemas } from "../src/mcp.js";

describe("transport-independent FHIR MCP", () => {
  it("keeps concurrent verified callers separate and returns fixed errors", async () => {
    const config = ConfigSchema.parse({
      AUDIT_HMAC_KEY: "a".repeat(64),
      NODE_ENV: "test",
    });
    const audit = new AuditLogger(config);
    const record = vi.spyOn(audit, "record").mockResolvedValue();
    const fhir: FhirClient = {
      async getPatient(id) {
        if (id === "synthetic-error")
          throw new Error("private response synthetic-error");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { resourceType: "Patient", id };
      },
      async searchObservations() {
        return [];
      },
      async getMedicationRequests() {
        return [];
      },
    };
    const sessions = await Promise.all(
      ["one", "two"].map(async (caller) => {
        const server = createFhirMcpServer(
          { config, fhir, audit },
          () => `spiffe://example.org/${caller}`,
        );
        const client = new Client({ name: "synthetic-test", version: "1" });
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        return { client, server };
      }),
    );
    try {
      const results = await Promise.all(
        sessions.map(({ client }, index) =>
          client.callTool({
            name: "get_patient",
            arguments: {
              patient_id: index === 0 ? "synthetic-ok" : "synthetic-error",
            },
          }),
        ),
      );
      expect(results[0]?.isError).not.toBe(true);
      expect(results[1]).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "FHIR request failed" }],
      });
      expect(record).toHaveBeenCalledTimes(2);
      expect(
        record.mock.calls.map(([entry]) => entry.caller_identity).sort(),
      ).toEqual(["spiffe://example.org/one", "spiffe://example.org/two"]);
      expect(config.CALLER_IDENTITY).toBe("anonymous-dev");
      const listed = await sessions[0]?.client.listTools();
      expect(listed?.tools.map((tool) => tool.name).sort()).toEqual(
        Object.keys(toolInputSchemas).sort(),
      );
    } finally {
      await Promise.all(
        sessions.flatMap(({ client, server }) => [
          client.close(),
          server.close(),
        ]),
      );
    }
  });

  it("keeps production audit off the MCP response stream", async () => {
    const logger = new AuditLogger(
      ConfigSchema.parse({
        AUDIT_HMAC_KEY: "ab".repeat(32),
        NODE_ENV: "production",
        FHIR_BASE_URL: "https://example.org/fhir",
      }),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await logger.record({
        tool: "get_patient",
        patient_id: "synthetic-id",
        caller_identity: "spiffe://example.org/research",
        request_id: "synthetic-request",
        status: "success",
      });
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledOnce();
      expect(stderr.mock.calls.flat().join(" ")).not.toContain("synthetic-id");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
