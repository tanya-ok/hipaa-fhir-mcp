#!/usr/bin/env node
// Live smoke test: starts the built stdio server with the current environment
// (FHIR_BASE_URL, SMART_* or FHIR_AUTH_TOKEN, PATIENT_POLICY_FILE,
// LOCAL_SYNTHETIC_PRINCIPAL, AUDIT_HMAC_KEY) and calls every tool for one patient.
// It prints only tool names, success or the fixed error text, and result counts:
// no clinical content is printed. Usage: SMOKE_PATIENT_ID=<id> node scripts/smoke-live.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const patient = process.env.SMOKE_PATIENT_ID;
if (!patient) {
  process.stderr.write("Set SMOKE_PATIENT_ID to a patient in your policy.\n");
  process.exit(2);
}
const args = {
  get_patient_summary: { patient_id: patient },
  get_patient: { patient_id: patient },
  get_conditions: { patient_id: patient },
  get_allergies: { patient_id: patient },
  get_immunizations: { patient_id: patient },
  get_encounters: { patient_id: patient },
  get_medication_list: { patient_id: patient },
  search_observations: { patient_id: patient, code: "http://loinc.org|8867-4" },
};

const client = new Client({ name: "smoke-live", version: "1" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/server.js", import.meta.url).pathname],
    env: process.env,
    stderr: "ignore",
  }),
);
const { tools } = await client.listTools();
let failed = 0;
for (const tool of tools) {
  const input = args[tool.name];
  if (!input) {
    console.log(`${tool.name}: skipped (needs its own input)`);
    continue;
  }
  const result = await client.callTool({ name: tool.name, arguments: input });
  const text = result.content?.[0]?.text ?? "";
  if (result.isError) {
    failed += 1;
    console.log(`${tool.name}: error "${text}"`);
    continue;
  }
  const value = JSON.parse(text);
  const shape = Array.isArray(value)
    ? `${value.length} items`
    : Object.entries(value)
        .map(([k, v]) => (Array.isArray(v) ? `${k}=${v.length}` : k))
        .join(", ");
  console.log(`${tool.name}: ok (${shape})`);
}
await client.close();
console.log(`${tools.length} tools, ${failed} failed`);
process.exit(failed ? 1 : 0);
