#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

// Exercise a compiled, installed package over real stdio and verified HTTPS.
const entry = resolve(process.argv[2] ?? "dist/server.js");
const scratch = await mkdtemp(join(tmpdir(), "fhir-package-demo-"));
let server;
let child;
let childExit;
let calls = 0;
let audit = "";
const pending = new Map();
const requests = [];
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout",
      join(scratch, "key.pem"),
      "-out",
      join(scratch, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  server = createServer(
    {
      key: await readFile(join(scratch, "key.pem")),
      cert: await readFile(join(scratch, "cert.pem")),
      minVersion: "TLSv1.2",
    },
    (req, res) => {
      const url = new URL(req.url, "https://localhost");
      requests.push(url.pathname);
      res.setHeader("Content-Type", "application/fhir+json");
      if (url.pathname.endsWith("/synthetic-missing")) {
        res
          .writeHead(404)
          .end(JSON.stringify({ diagnostic: "synthetic-private-diagnostic" }));
        return;
      }
      let value;
      if (url.pathname.endsWith("/Patient/synthetic-ok")) {
        value = {
          resourceType: "Patient",
          id: "synthetic-ok",
          active: true,
          text: { div: "synthetic-private-narrative" },
        };
      } else if (url.pathname.endsWith("/Patient/synthetic-wrong")) {
        value = { resourceType: "Observation", id: "synthetic-wrong" };
      } else {
        const medication = url.pathname.endsWith("/MedicationRequest");
        assert.equal(url.searchParams.get("patient"), "synthetic-ok");
        value = {
          resourceType: "Bundle",
          type: "searchset",
          entry: [
            {
              resource: medication
                ? {
                    resourceType: "MedicationRequest",
                    id: "synthetic-med",
                    status: "active",
                    intent: "order",
                    subject: { reference: "Patient/synthetic-ok" },
                    medicationCodeableConcept: { coding: [{ code: "demo" }] },
                  }
                : {
                    resourceType: "Observation",
                    id: "synthetic-obs",
                    status: "final",
                    code: { coding: [{ code: "8867-4" }] },
                    subject: { reference: "Patient/synthetic-ok" },
                    valueQuantity: { value: 60, unit: "/min" },
                  },
            },
          ],
        };
      }
      res.end(JSON.stringify(value));
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  child = spawn(process.execPath, [entry], {
    cwd: scratch,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NODE_EXTRA_CA_CERTS: join(scratch, "cert.pem"),
      FHIR_BASE_URL: `https://127.0.0.1:${server.address().port}/fhir`,
      AUDIT_HMAC_KEY: randomBytes(32).toString("hex"),
      CALLER_IDENTITY: "synthetic-package-demo",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  childExit = once(child, "exit");
  child.stderr.on("data", (chunk) => {
    audit += chunk;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  let sequence = 0;
  async function rpc(method, params) {
    const id = ++sequence;
    let timer;
    try {
      return await Promise.race([
        new Promise((done) => {
          pending.set(id, done);
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
          );
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("MCP demo timed out")),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  }
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "synthetic-package-demo", version: "1" },
  });
  const { version } = JSON.parse(
    await readFile(resolve(entry, "../../package.json"), "utf8"),
  );
  assert.equal(initialized.result.serverInfo.version, version);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  assert.equal((await rpc("tools/list", {})).result.tools.length, 3);
  async function call(name, args) {
    calls++;
    return rpc("tools/call", { name, arguments: args });
  }
  for (const [name, args, expected] of [
    [
      "get_patient",
      { patient_id: "synthetic-ok" },
      { resourceType: "Patient", id: "synthetic-ok", active: true },
    ],
    [
      "search_observations",
      { patient_id: "synthetic-ok", code: "http://loinc.org|8867-4" },
      null,
    ],
    ["get_medication_list", { patient_id: "synthetic-ok" }, null],
  ]) {
    const result = (await call(name, args)).result;
    assert.ok(!result.isError);
    const value = JSON.parse(result.content[0].text);
    if (expected) assert.deepEqual(value, expected);
    else assert.equal(value.length, 1);
    assert.ok(!JSON.stringify(result).includes("synthetic-private"));
  }
  for (const patient_id of ["synthetic-missing", "synthetic-wrong"]) {
    assert.deepEqual((await call("get_patient", { patient_id })).result, {
      content: [{ type: "text", text: "FHIR request failed" }],
      isError: true,
    });
  }
  const requestsBeforeRejection = requests.length;
  for (const [name, args] of [
    ["get_patient", { patient_id: "synthetic-private/invalid" }],
    ["synthetic-private-tool", {}],
  ]) {
    assert.equal(
      (await call(name, args)).error.message,
      "Tool request rejected",
    );
  }
  assert.equal(requests.length, requestsBeforeRejection);
  assert.ok(
    !(await call("get_patient", { patient_id: "synthetic-ok" })).result.isError,
  );
  child.stdin.end();
  const [code] = await Promise.race([
    childExit,
    new Promise((_, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Child cleanup timed out")),
        5000,
      );
      timeout.unref();
    }),
  ]);
  assert.equal(code, 0);
  const records = audit
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.length, calls);
  assert.equal(
    records.filter((record) => record.status === "success").length,
    4,
  );
  assert.ok(
    records.every((record) => /^[a-f0-9]{64}$/.test(record.patient_id_hmac)),
  );
  for (const value of [
    "synthetic-ok",
    "synthetic-missing",
    "synthetic-wrong",
    "synthetic-private",
  ])
    assert.ok(!audit.includes(value));
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  console.log(
    JSON.stringify(
      {
        package_version: initialized.result.serverInfo.version,
        node: process.version,
        transport: "real stdio and local verified HTTPS",
        synthetic_backend: true,
        calls,
        audit_records: records.length,
        rejected_before_backend: 2,
        recovery: "passed",
        cleanup: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await childExit;
  }
  server?.closeAllConnections();
  server?.close();
  await rm(scratch, { recursive: true, force: true });
}
