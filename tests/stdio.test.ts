import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

describe("actual stdio process", () => {
  it("audits accepted, rejected and failed calls exactly once without contaminating stdout", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        "--import",
        "./tests/fixtures/stdio-http.ts",
        "src/server.ts",
      ],
      env: {
        NODE_ENV: "production",
        AUDIT_HMAC_KEY: "ab".repeat(32),
        FHIR_BASE_URL: "https://example.org/fhir",
      },
      stderr: "pipe",
    });
    let audit = "";
    transport.stderr?.on("data", (chunk) => {
      audit += chunk.toString();
    });
    const client = new Client({ name: "synthetic-stdio-check", version: "1" });
    const protocolErrors: Error[] = [];
    client.onerror = (error) => protocolErrors.push(error);
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.version).toBe("0.4.0");
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(3);
      expect(
        await client.callTool({
          name: "get_patient",
          arguments: { patient_id: "synthetic-ok" },
        }),
      ).toMatchObject({
        content: [
          {
            type: "text",
            text: expect.not.stringContaining("synthetic-private"),
          },
        ],
      });
      for (const patient_id of ["synthetic-error", "synthetic-wrong"]) {
        expect(
          await client.callTool({
            name: "get_patient",
            arguments: { patient_id },
          }),
        ).toMatchObject({
          isError: true,
          content: [{ type: "text", text: "FHIR request failed" }],
        });
      }
      for (const args of [
        {
          name: "get_patient",
          arguments: { patient_id: "synthetic-private/invalid" },
        },
        {
          name: "synthetic-private-unknown",
          arguments: { patient_id: "synthetic-ok" },
        },
        { name: "constructor", arguments: {} },
      ]) {
        await expect(client.callTool(args)).rejects.toThrow(
          "Tool request rejected",
        );
      }
      // A later valid call proves denials did not corrupt protocol framing or state.
      await client.callTool({
        name: "get_patient",
        arguments: { patient_id: "synthetic-ok" },
      });
    } finally {
      await client.close();
    }
    const records = audit
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(7);
    expect(records.filter((entry) => entry.status === "success")).toHaveLength(
      2,
    );
    expect(
      records.filter((entry) => entry.error_code === "invalid_arguments"),
    ).toHaveLength(1);
    expect(
      records.filter((entry) => entry.error_code === "unknown_tool"),
    ).toHaveLength(2);
    for (const value of [
      "synthetic-ok",
      "synthetic-error",
      "synthetic-wrong",
      "synthetic-private",
    ])
      expect(audit).not.toContain(value);
  }, 30_000);
});
