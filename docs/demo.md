# Demo: hipaa-fhir-mcp end-to-end

## Local package demonstration

This repeatable path uses synthetic fixtures behind a real local HTTPS server,
with certificate verification enabled, and calls the compiled server over stdio.
It needs Node 26+, pnpm and OpenSSL. It does not contact a clinical system or an
AI provider. Temporary certificates and the random audit key are deleted on exit.

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/demo-package.mjs
```

To test the distributable separately, pack it into a temporary directory,
install the resulting tarball in another empty directory, and pass the installed
`dist/server.js` path to the same script:

```sh
node scripts/demo-package.mjs /absolute/path/to/installed/hipaa-fhir-mcp/dist/server.js
```

The script checks all three tools, a missing resource, a wrong resource type,
invalid arguments, an unknown tool, and a successful call after the failures.
It verifies one hash-only audit record per call, protocol-only stdout, no
backend request for rejected inputs, and child/server cleanup. A passing result
prints eight calls and eight audit records. This was exercised on 2026-10-07
with an independently installed 0.3.0 tarball on Node 26.10.0. The backend data
is synthetic; the HTTPS connection, MCP framing and child process are real.

## Interactive sandbox and Desktop walkthrough

A reproducible walkthrough that takes the prototype from a clean clone to
a working Claude Desktop session and shows the audit trail growing in real
time.

You will run two terminals side by side:

| Terminal | Purpose |
|---|---|
| T1 | Start the MCP Inspector with the server attached, then later stop it and let Claude Desktop drive the server |
| T2 | `tail -f` the audit log so every tool call is visible the moment it lands |

No PHI is involved. The walkthrough talks to the public SMART sandbox at
`https://r4.smarthealthit.org`. The patient ids it returns are synthetic.

## What the demo proves

| Claim | Evidence |
|---|---|
| The three MCP tools work end to end | Inspector returns a real `Patient` resource, Desktop calls them from natural-language prompts |
| Patient ids never land in logs | `grep` for the id in the audit file returns nothing; only the keyed HMAC-SHA-256 digest is present |
| Each tool call emits a structured audit record | T2 grows by one JSON line per call, with `tool`, `patient_id_hmac`, `caller_identity`, `request_id`, `status` |
| Claude Desktop can use the server through MCP | The three tools appear in the Desktop tools menu under `hipaa-fhir-mcp` |

## Prerequisites

- Node 26+
- pnpm 10 (Corepack reads the version pinned in `package.json`; Node 25+ does not bundle it, so run `npm install -g corepack && corepack enable` once)
- `git clone` of this repo with `pnpm install` already run
- Claude Desktop installed (macOS or Windows)
- `python3` on `PATH` (only used to extract one field from a JSON response)

All shell snippets below use fish syntax. Translate to bash or zsh as needed.

## Step 1: configure environment

From the repo root:

```fish
cp .env.example .env
```

Open `.env` and set these values. The shipped `AUDIT_HMAC_KEY` is a demo zero-key that lets the prototype run; replace it with the output of `openssl rand -hex 32` for anything beyond a sandbox-only walkthrough. Production mode refuses this key.

```
AUDIT_LOG_FILE=./audit-demo.log
CALLER_IDENTITY=demo-inspector
AUDIT_HMAC_KEY=0000000000000000000000000000000000000000000000000000000000000000
```

`AuditLogger` appends to `AUDIT_LOG_FILE` when it is set, in any mode. Without
it, or if the file cannot be written, the logger writes to stderr, preserving
stdout for the MCP protocol. Configure your runtime log collector to ingest stderr.

## Step 2: pull a fresh patient id

The SMART sandbox cycles its data periodically, so any hard-coded id
goes stale. Pull a current one:

```fish
curl -s "https://r4.smarthealthit.org/Patient?_count=1&_elements=id" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['entry'][0]['resource']['id'])"
```

Copy the printed id. The rest of the walkthrough refers to it as
`<PATIENT_ID>`.

## Step 3 (T1): start the MCP Inspector

```fish
pnpm dlx @modelcontextprotocol/inspector node --env-file=.env --import tsx src/server.ts
```

Inspector prints a `localhost` URL on startup. Open it in a browser. The
left pane lists the three registered tools:

- `get_patient`
- `search_observations`
- `get_medication_list`

Pick `get_patient`, paste `<PATIENT_ID>` into the input field, and run it.
The right pane returns a FHIR R4 `Patient` resource as JSON.

## Step 4 (T2): tail the audit log

In a second terminal, also at the repo root:

```fish
tail -f audit-demo.log
```

The first Inspector call from Step 3 already produced one line. It looks
like this:

```json
{"timestamp":"2026-04-26T17:42:11.812Z","tool":"get_patient","patient_id_hmac":"9b74c989...","caller_identity":"demo-inspector","request_id":"a3e1b8c2-...","status":"success"}
```

Note the field is `patient_id_hmac`, not `patient_id`. The keyed HMAC depends on `AUDIT_HMAC_KEY`, so logs from instances configured with different keys are not cross-referenceable. The plaintext id
never appears. Confirm:

```fish
grep -F '<PATIENT_ID>' audit-demo.log
```

Returns nothing. That is the point.

## Step 5 (T1): exercise the other two tools

Still in Inspector, run:

| Tool | Inputs |
|---|---|
| `search_observations` | `patient_id` = `<PATIENT_ID>`, `code` = <code>http://loinc.org&#124;8867-4</code> (heart rate) |
| `get_medication_list` | `patient_id` = `<PATIENT_ID>` |

T2 grows by one line per call. Each carries the same `patient_id_hmac`
because the same id was used.

When you are ready to move to Claude Desktop, stop Inspector with
`Ctrl+C` in T1. Desktop spawns its own copy of the server process and
will not share with Inspector.

## Step 6 (T1 free, T2 still tailing): connect Claude Desktop

Edit the Desktop config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add (or merge into existing `mcpServers`):

```json
{
  "mcpServers": {
    "hipaa-fhir-mcp": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/hipaa-fhir-mcp/dist/server.js"
      ],
      "env": {
        "FHIR_BASE_URL": "https://r4.smarthealthit.org",
        "CALLER_IDENTITY": "demo-desktop",
        "NODE_ENV": "development",
        "AUDIT_HMAC_KEY": "<GENERATE_A_LOCAL_KEY_WITH_OPENSSL_RAND_HEX_32>",
        "AUDIT_LOG_FILE": "/absolute/path/to/hipaa-fhir-mcp/audit-demo.log"
      }
    }
  }
}
```

Replace the HMAC key placeholder with a locally generated key before starting
Desktop. Do not publish the configured key or the resulting configuration.

All three paths must be absolute. Desktop launches the child process
from its own working directory, not from the repo, so a relative
`./audit-demo.log` would land somewhere unexpected and T2 would never
see new lines. macOS GUI apps also do not always inherit your shell
`PATH`, so a bare `node` may not resolve. Build with `pnpm build`, then run
`which node` and paste
the result into `command`.

`CALLER_IDENTITY` is set to `demo-desktop` here, distinct from the
Inspector value, so the audit lines from each surface are easy to tell
apart in T2.

Restart Claude Desktop. The three tools appear in the tools menu under
`hipaa-fhir-mcp`.

## Step 7: drive the server from Desktop

T2 (`tail -f audit-demo.log`) should still be running. Each prompt below
appends one or more audit lines with `caller_identity: "demo-desktop"`.

| Prompt to paste into Desktop | Tool the model should call |
|---|---|
| Fetch the FHIR Patient with id `<PATIENT_ID>`. | `get_patient` |
| Search heart rate observations (LOINC code <code>http://loinc.org&#124;8867-4</code>) for patient `<PATIENT_ID>`. | `search_observations` |
| List active medications for patient `<PATIENT_ID>`. | `get_medication_list` |

Replace `<PATIENT_ID>` with the value from Step 2. After the third
prompt, T2 holds three new lines, each with the keyed HMAC of the id
and `status: "success"`.

If a tool call fails (network blip, expired patient id), the audit
record arrives anyway with `status: "error"` and an `error_code` field.
That is the failure mode the prototype is built around: an audit record
is produced for every attempt, success or not.

## Step 8: prove nothing leaked

Two checks worth running before publishing screenshots from the demo:

```fish
pnpm check:phi
```

The PHI-shape sweep walks the working tree and exits 0 if no SSN-,
US-phone-, or non-allowlisted-email shapes are present. The audit log
is included in the scan.

```fish
grep -F '<PATIENT_ID>' audit-demo.log
```

Returns nothing. The audit format is hash-only by construction; this is
the cheap end-to-end check that the contract held.

## Cleanup

```fish
# T1: stop Inspector if still running (Ctrl+C)

# Remove the hipaa-fhir-mcp entry from claude_desktop_config.json,
# then restart Desktop.

# Optional: delete the demo audit log
rm audit-demo.log
```

## Where this fits in the bigger picture

The Inspector and Desktop paths exercised here are the development
surface. A production deployment replaces:

- `node --env-file=.env --import tsx src/server.ts` with the compiled `node dist/server.js`
  running in a Fargate task or EKS pod
- the SMART sandbox with an AWS HealthLake datastore reached over a VPC
  interface endpoint
- `CALLER_IDENTITY=demo-desktop` with a SPIFFE SVID read from the
  Workload API socket
- the local audit log file with stderr collected by the container runtime and
  forwarded to CloudWatch Logs

The control-by-control mapping is in
[`hipaa-compliance-mapping.md`](hipaa-compliance-mapping.md). The
production-path sketch is in the README under
[Production deployment notes](https://github.com/tanya-ok/hipaa-fhir-mcp/blob/main/README.md#production-deployment-notes).
