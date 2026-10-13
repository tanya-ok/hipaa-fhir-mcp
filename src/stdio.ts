import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { toolInputSchemas } from "./mcp.js";
import type { ToolDeps } from "./tools/types.js";

/** Audit SDK pre-handler rejections without duplicating the accepted tool's record. */
export class AuditedStdioTransport extends StdioServerTransport {
  constructor(private readonly deps: ToolDeps) {
    super();
  }

  override async start(): Promise<void> {
    const dispatch = this.onmessage;
    this.onmessage = (message) => {
      void this.receive(message, dispatch).catch(() => {
        this.onerror?.(new Error("Stdio request audit failed"));
      });
    };
    await super.start();
  }

  private async receive(
    message: JSONRPCMessage,
    dispatch: typeof this.onmessage,
  ): Promise<void> {
    if (!("method" in message) || message.method !== "tools/call") {
      dispatch?.(message);
      return;
    }
    const call = CallToolRequestSchema.safeParse(message);
    const name = call.success ? call.data.params.name : "";
    const known = Object.hasOwn(toolInputSchemas, name);
    const schema = known
      ? toolInputSchemas[name as keyof typeof toolInputSchemas]
      : undefined;
    if (
      call.success &&
      "id" in message &&
      !("task" in call.data.params) &&
      schema?.safeParse(call.data.params.arguments ?? {}).success
    ) {
      dispatch?.(message);
      return;
    }
    await this.deps.audit.record({
      tool: known ? name : "unknown_tool",
      patient_id: "invalid-input",
      caller_identity: this.deps.config.CALLER_IDENTITY,
      request_id: randomUUID(),
      status: "error",
      error_code: known ? "invalid_arguments" : "unknown_tool",
    });
    if ("id" in message)
      await this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: "Tool request rejected" },
      });
  }
}
