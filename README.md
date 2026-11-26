<div align="center">

# hipaa-fhir-mcp

**Read-only FHIR R4 tools for AI agents, with deny-by-default patient access and HMAC-hashed audit.**

[![Release](https://img.shields.io/github/v/release/tanya-ok/hipaa-fhir-mcp?style=flat-square&color=0e7490)](https://github.com/tanya-ok/hipaa-fhir-mcp/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/tanya-ok/hipaa-fhir-mcp/ci.yml?branch=main&style=flat-square&label=CI&logo=github)](https://github.com/tanya-ok/hipaa-fhir-mcp/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/tanya-ok/hipaa-fhir-mcp/codeql.yml?branch=main&style=flat-square&label=CodeQL&logo=github)](https://github.com/tanya-ok/hipaa-fhir-mcp/actions/workflows/codeql.yml)
[![License](https://img.shields.io/github/license/tanya-ok/hipaa-fhir-mcp?style=flat-square&color=2dd4bf)](LICENSE)
<br/>
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.tanya--ok%2Fhipaa--fhir--mcp-6366f1?style=flat-square)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.tanya-ok/hipaa-fhir-mcp)
[![Glama score](https://glama.ai/mcp/servers/tanya-ok/hipaa-fhir-mcp/badges/score.svg)](https://glama.ai/mcp/servers/tanya-ok/hipaa-fhir-mcp)
[![FHIR R4](https://img.shields.io/badge/FHIR-R4-0ea5e9?style=flat-square)](https://hl7.org/fhir/R4/)
[![SMART Backend Services](https://img.shields.io/badge/SMART-Backend%20Services-0ea5e9?style=flat-square)](https://hl7.org/fhir/smart-app-launch/STU2.2/backend-services.html)
[![Node](https://img.shields.io/badge/node-%E2%89%A526-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](tsconfig.json)

[![hipaa-fhir-mcp MCP server: quality and maintenance score on Glama](https://glama.ai/mcp/servers/tanya-ok/hipaa-fhir-mcp/badges/card.svg)](https://glama.ai/mcp/servers/tanya-ok/hipaa-fhir-mcp)

**[Docs](https://tanya-ok.github.io/hipaa-fhir-mcp/)** · **[Install](#install-in-claude-desktop)** · **[Tools](#architecture)** · **[Patient access](#patient-access-policy)** · **[Releases](https://github.com/tanya-ok/hipaa-fhir-mcp/releases)** · **[Changelog](CHANGELOG.md)**

</div>

> **Prototype.** Synthetic data only, not for real PHI. Tested against the Epic sandbox with its test patients only; not tested against a production EHR.

| What the agent gets | What stays in place |
|---|---|
| Patient summary, observations, medications, conditions, allergies, immunizations, encounters | Read only: no write path to patient data |
| Codes, statuses and dates | Names, free text and notes are dropped before the model sees a record |
| Fixed, safe error texts | Every call: one audit record, patient id HMAC-hashed |
| Any FHIR R4 server, including SMART Backend Services | Deny by default: a grant per caller, patient and tool |

## Try it without installing

A public demo runs at `https://hipaa-fhir-mcp-demo.fly.dev/mcp` (Streamable HTTP, no key). It can only reach the public synthetic SMART sandbox and five synthetic patients, so it never serves real data.

```sh
claude mcp add --transport http hipaa-fhir-demo https://hipaa-fhir-mcp-demo.fly.dev/mcp
```

Then ask: *"Summarize patient 1ac8947d-038f-4cc7-81fa-a32e694187e8."* The other demo patients are listed in [`deploy/demo/patient-policy.json`](deploy/demo/patient-policy.json).

## Why this exists

AI agents are increasingly given direct access to data systems through MCP. In healthcare, that data is regulated and the required controls are specific: HIPAA §164.312 names them. Most public MCP examples ignore the regulatory context; most HIPAA write-ups predate AI agents.

This repository sits at that intersection. It is a working scaffold that lets an engineer see, in one place:

- which Technical Safeguards a HIPAA-aligned MCP server actually needs,
- which ones live in code, which live in infrastructure, and which are organizational policy,
- what the production path looks like when the prototype's stubs become real implementations.

The point is not to ship a compliant system. The point is to make the gap between "MCP demo" and "HIPAA-compliant deployment" concrete enough to discuss. The full gap list is in [`docs/hipaa-compliance-mapping.md`](docs/hipaa-compliance-mapping.md). See also the [data flow](docs/data-flow.md), the [threat model](docs/threat-model.md) and [deploying inside your own HIPAA program](docs/deploy-inside-a-hipaa-program.md).

The [shared Kubernetes lab](docs/kubernetes-lab.md) connects this server to `mcp-spiffe-bridge` and `mcp-svid-auth` using real SPIRE mTLS and OAuth. Audit output uses stderr, leaving stdout exclusively for stdio MCP messages.

The [development plan](docs/development-plan.md) records the 2026-10-04 review, confirmed boundary gaps, and the next milestones.

## HIPAA scope statement

| | |
|---|---|
| **In scope** | §164.312(a)(2)(iv) encryption, §164.312(b) audit controls (structured JSON, HMAC-SHA-256 patient id hashing with a server-side secret, no PHI in logs), §164.312(e) transmission security (TLS), and stubs for the production path: SMART OAuth 2.1 + PKCE, SPIFFE SVID workload identity, KMS envelope encryption. |
| **Not in scope** | Administrative and Physical safeguards - those are organizational controls. A real BAA with AWS and any downstream LLM provider. Production SMART/KMS wiring and identity integration with a real clinical backend. The stdio SPIFFE adapter remains a stub; the local Kubernetes gateway uses real SPIRE through `mcp-spiffe-bridge`. |
| **Data** | Public, synthetic sandbox at `https://r4.smarthealthit.org`. The Kubernetes lab uses an explicit offline synthetic fixture. **No PHI** is used by either demo. |

The prototype deliberately does not ship with fake production posture. Treating it as compliant out of the box would itself be non-compliant.

## Claims and the tests that pin them

Every security claim in this README has a test that fails if the claim stops being true. CI runs all of them on every pull request.

| Claim | Test that fails if it stops being true |
|---|---|
| No tool runs for a patient outside the caller's grant, and the FHIR server is not called | [`patient-policy.test.ts`](tests/patient-policy.test.ts) "denies another patient before dispatch with one audit record" |
| An expired grant is denied, and the FHIR server is not called | [`patient-policy.test.ts`](tests/patient-policy.test.ts) "denies an expired grant before dispatch with one audit record" |
| Without a policy, every call is denied | [`patient-policy.test.ts`](tests/patient-policy.test.ts) "denies everything without a policy"; [`stdio.test.ts`](tests/stdio.test.ts) "denies every tool call when no policy or principal is configured" |
| Identity or grants in tool arguments are ignored | [`patient-policy.test.ts`](tests/patient-policy.test.ts) "ignores identity and grant claims in tool arguments and metadata" |
| Every call writes exactly one audit record, with the patient id HMAC-hashed and no PHI | [`stdio.test.ts`](tests/stdio.test.ts) "audits accepted, rejected and failed calls exactly once without contaminating stdout"; [`tools.test.ts`](tests/tools.test.ts) "writes one line per record with HMAC patient id and no PHI" |
| An edited, removed or repeated audit record is detected | [`audit-chain.test.ts`](tests/audit-chain.test.ts) "reports an edited record", "reports a removed record", "reports a repeated record" |
| Audit records name the key that hashed them, so a key can be rotated | [`tools.test.ts`](tests/tools.test.ts) "labels records with a stable key id that differs per key" |
| Names, free text and notes never reach the model | [`client.test.ts`](tests/client.test.ts) "follows bounded same-base pagination and strips nested free text"; [`patient-records.test.ts`](tests/patient-records.test.ts) "checks AllergyIntolerance.patient and drops free text" |
| A resource for another patient fails the call | [`patient-records.test.ts`](tests/patient-records.test.ts) "refuses an Immunization for another patient" |
| Upstream error text never reaches the agent | [`client.test.ts`](tests/client.test.ts) "discards upstream error text and response body" |
| Results are bounded; an over-limit search fails instead of truncating | [`client.test.ts`](tests/client.test.ts) "bounds aggregate results even when each page is within its limit" |
| Pagination never follows a link off the configured FHIR base | [`client.test.ts`](tests/client.test.ts) "accepts a same-base root continuation used by paging servers" and the pagination destination checks in the same file |

## Where it falls short

- **Synthetic data only.** Tested against the Epic sandbox with its test patients only, never against a production EHR; not for real PHI. Using real PHI needs your own HIPAA program, BAAs with your hosting and model providers, and an independent review this project has not had.
- **Read only.** No writes, by design.
- **The patient policy is a local file.** It is not SMART patient-level authorization or consent management.
- **One maintainer.** Issues and reviews are welcome; see [CONTRIBUTING](CONTRIBUTING.md).

## Architecture

```
            ┌──────────────────────┐
            │  Claude Desktop      │
            │  (MCP host)          │
            └──────────┬───────────┘
                       │ stdio (JSON-RPC)
                       ▼
     ┌─────────────────────────────────────┐
     │  hipaa-fhir-mcp                     │
     │                                     │
     │  ┌────────────┐  ┌───────────────┐  │
     │  │ tools/     │  │ audit/logger  │──┼──► stderr -> collector
     │  │            │  │ (HMAC-SHA-256)│  │
     │  └─────┬──────┘  └───────────────┘  │
     │        │                            │
     │        ▼                            │
     │  ┌────────────┐  ┌───────────────┐  │
     │  │ fhir/client│  │ security/     │  │
     │  │ (axios+TLS)│  │  ├ oauth.ts   │  │  ← SMART stub
     │  │            │  │  ├ spiffe.ts  │  │  ← Workload API stub
     │  │            │  │  └ kms.ts     │  │  ← envelope encryption stub
     │  └─────┬──────┘  └───────────────┘  │
     │        │                            │
     └────────┼────────────────────────────┘
              │ HTTPS (TLS 1.2+)
              ▼
      ┌─────────────────────┐
      │ FHIR R4 sandbox or  │
      │ AWS HealthLake      │
      └─────────────────────┘
```

The nine read-only MCP tools exposed to Claude. Each needs its own grant in the patient policy:

| Tool | Input | Returns |
|---|---|---|
| `get_patient_summary` | `patient_id` | Patient, active conditions, allergies, active medications |
| `get_patient` | `patient_id` | `Patient` resource |
| `search_observations` | `patient_id`, `code` (e.g. `http://loinc.org\|8867-4`) | `Observation[]` |
| `get_medication_list` | `patient_id` | active `MedicationRequest[]` |
| `get_conditions` | `patient_id` | `Condition[]` |
| `get_allergies` | `patient_id` | `AllergyIntolerance[]` |
| `get_immunizations` | `patient_id` | `Immunization[]` |
| `get_encounters` | `patient_id`, optional `since` (`YYYY-MM-DD`) | `Encounter[]` |
| `find_patient` | `identifier` (`system\|value`) | matching `Patient[]` inside your grant |

Results keep codes, statuses and dates only; display names, free text and notes are dropped. More than 200 results returns an error that asks the agent to narrow the request.

Every invocation emits a structured audit record:

```json
{
  "timestamp": "2026-04-21T10:15:03.123Z",
  "tool": "get_patient",
  "patient_id_hmac": "9b74c9897bac770ffc029102a200c5de...",
  "caller_identity": "local-dev",
  "request_id": "a3e1...",
  "status": "success"
}
```

`patient_id` is never written to any log. The audit record stores only an HMAC-SHA-256 of the id, computed with a server-side secret (`AUDIT_HMAC_KEY`). Plain SHA-256 would be reversible by enumeration if the id space were small or predictable; the keyed HMAC closes that gap. The hash is deterministic by design, which lets audit lines and KMS decrypt logs cross-reference the same patient via `kms:EncryptionContext`. Anyone with read access to the audit log can therefore count requests per patient, but cannot reverse to the plaintext id; the mitigation is access control on the log stream, not the hash.

Implementation and local evidence: [quorum hardening](docs/quorum-hardening-2026-10-07.md).

## Validated response boundary

The HTTP client validates and projects a deliberately small FHIR R4 subset.
Patient output contains id, active, gender and birthDate. Observations contain
status, coded concepts, subject references, times and quantitative/coded values.
Medication requests contain status, intent, subject, coded/referenced medication
and authoredOn; inactive requests are filtered. Names, narrative, display text,
notes, identifiers and extensions are not returned. This is not a complete FHIR
conformance validator or a clinical authorization policy.

Search follows same-origin continuation links confined to the configured FHIR
base, up to five pages and 200 resources, with a 1 MiB decoded response limit per
page. Requests ask for 50 results per page. A cycle, excess limit, malformed
entry, repeated resource or different patient fails the entire call with a fixed
error; partial results are never silently reported as complete. HTTP redirects
are disabled. TLS verification remains enabled with TLS 1.2 minimum.
Environment proxy settings (`HTTP_PROXY`, `HTTPS_PROXY`) are ignored, so the
backend bearer token is only sent directly to the configured FHIR origin.
See [FHIR R4 search](https://hl7.org/fhir/R4/search.html#count) for server-driven
continuation semantics.

Stdio audits schema rejections and unknown-tool calls before SDK dispatch, using
fixed labels instead of untrusted tool names or invalid arguments. Accepted
calls retain their handler audit. Each invocation has one record; stdout carries
JSON-RPC only. An explicit endpoint does not establish production authentication:
SMART, clinical consent, durable log collection and key management remain gaps.

## Requirements

- Node.js 26+
- pnpm (Corepack picks up the version pinned in `package.json`; Node 25+ does not bundle it, so run `npm install -g corepack && corepack enable` once)

## Install

```fish
cd hipaa-fhir-mcp
pnpm install
cp .env.example .env   # tweak AUDIT_LOG_FILE, CALLER_IDENTITY if you want
cp patient-policy.example.json patient-policy.json   # put a synthetic patient id in it
chmod 600 patient-policy.json
```

Then set `PATIENT_POLICY_FILE` to the absolute path of `patient-policy.json` and `LOCAL_SYNTHETIC_PRINCIPAL=local-synthetic-operator` in `.env`. Without both, every tool call returns `Patient access not authorized` (see [Patient access policy](#patient-access-policy)).

The required env vars are:

| Var | Purpose |
|---|---|
| `AUDIT_HMAC_KEY` | Server-side secret, exactly 64 hex characters, for HMAC of patient ids in the audit log. Generate with `openssl rand -hex 32`. The `.env.example` ships a demo-only zero-key so the prototype runs against the public sandbox out of the box; production refuses it and any other single repeated character. |
| `FHIR_BASE_URL` | HTTPS FHIR R4 base URL without embedded credentials, query or fragment. Required explicitly in production; explicit development/test without a backend token may default to the public synthetic SMART sandbox. If NODE_ENV is omitted or a token is set, an explicit URL is required. |
| `CALLER_IDENTITY` | Operator-configured audit label for stdio; not authenticated identity. The separate Kubernetes gateway supplies verified SPIFFE identity. |
| `AUDIT_LOG_FILE` | Optional file sink for audit records, honoured in every mode including production. If unset, or if the sink fails, audit records go to stderr. Production never requires a file. |

## Run locally

```fish
# One-shot, no build needed:
pnpm dev

# Or directly:
node --env-file=.env --import tsx src/server.ts
```

`pnpm dev` loads `.env` when present; explicit environment values take precedence.
The built `pnpm start` command uses the process environment, so deployments must
supply the required values themselves.

The server talks MCP over stdio. To exercise it from a terminal, use the MCP Inspector:

```fish
pnpm dlx @modelcontextprotocol/inspector node --env-file=.env --import tsx src/server.ts
```

The SMART sandbox cycles its data periodically, so hard-coded patient ids go stale. Pull a current id with:

```fish
curl -s "https://r4.smarthealthit.org/Patient?_count=1&_elements=id" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['entry'][0]['resource']['id'])"
```

## Build and test

```fish
pnpm typecheck
pnpm test
pnpm build
pnpm check          # Biome lint + format check
pnpm check:fix      # apply Biome fixes
pnpm check:phi      # PHI shape sweep
```

## Container image

Each release publishes a multi-arch image (amd64, arm64) with SBOM and provenance attestations, signed keylessly with cosign:

```sh
docker pull ghcr.io/tanya-ok/hipaa-fhir-mcp:latest
cosign verify ghcr.io/tanya-ok/hipaa-fhir-mcp:latest \
  --certificate-identity-regexp '^https://github.com/tanya-ok/hipaa-fhir-mcp/\.github/workflows/image\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The default command runs the stdio server; pass `dist/http-server.js` as the command for Streamable HTTP. The image runs as the non-root `node` user and has no shell entry point beyond `node`.
## Run over HTTP

`hipaa-fhir-mcp-http` serves MCP over Streamable HTTP (stateless) at `POST /mcp`, with `GET /healthz` for health checks. It refuses to start unless exactly one of these is set:

| Mode | Setting | Who can call |
|---|---|---|
| Bearer tokens | `MCP_HTTP_TOKENS_FILE` (mode 600): `{"version":1,"tokens":[{"principal":"...","sha256":"<hex>"}]}` | A caller whose token hashes to a listed digest acts as that principal in the patient policy |
| Public demo | `MCP_DEMO=1` | Anyone, as principal `public-demo`; only with `FHIR_BASE_URL=https://r4.smarthealthit.org` and no backend credentials |

The file stores SHA-256 digests only; generate a token with `openssl rand -base64 32` and its digest with `printf %s "$TOKEN" | shasum -a 256`. `PATIENT_POLICY_FILE` is required in both modes.

Other settings: `MCP_HTTP_HOST` (default `127.0.0.1`), `MCP_HTTP_PORT` (default `8080`), `MCP_ALLOWED_HOSTS` (comma-separated `Host` values; set it behind a public hostname), `MCP_RATE_LIMIT_PER_MINUTE` (default 60 per client address), `MCP_CLIENT_IP_HEADER` (behind a proxy, the header holding the client address, for example `Fly-Client-IP`; set it only when the proxy always overwrites that header). Bodies over 64 KB, batches and methods other than POST are refused. Invalid tool calls are audited before rejection, as on stdio. Terminate TLS in front of the server.
## Connect to an authenticated FHIR server

For servers that use [SMART Backend Services](https://hl7.org/fhir/smart-app-launch/STU2.2/backend-services.html), set:

| Variable | Value |
|---|---|
| `FHIR_BASE_URL` | the server's FHIR base URL (required) |
| `SMART_CLIENT_ID` | the client id the authorization server issued |
| `SMART_KEY_ID` | the `kid` of the registered public key |
| `SMART_PRIVATE_KEY_FILE` | PEM private key, RSA 2048+ (RS384) or EC P-384 (ES384), mode 600 |
| `SMART_SCOPE` | optional; defaults to `system/<Resource>.rs` for every resource the tools read |
| `SMART_TOKEN_URL` | required unless `NODE_ENV` is `development` or `test`; in those modes read from `.well-known/smart-configuration` |

The server signs a short-lived client assertion (5 minutes, unique `jti`), exchanges it for an access token, caches the token until a minute before expiry and gets a new one once after a 401. Token endpoint responses and errors are never logged or returned to the agent. The token is sent only to the FHIR base origin. A static `FHIR_AUTH_TOKEN` remains available; the two cannot be combined.

The token flow was exercised against the public SMART bulk-data reference server and, on 2026-11-25, against the Epic sandbox (`fhir.epic.com`, R4, backend app with a JWKS URL): `scripts/smoke-live.mjs` ran all nine tools for one Epic test patient with no failures, including `find_patient` by identifier. The Epic app must use 64-character FHIR ids ("Use 64-Character-Limited FHIR IDs for USCDI FHIR Resources"); longer ids are rejected as invalid. On 2026-11-26 release 0.8.0 also passed all nine tools against a local Medplum 5.2.18 with an RS384 key; [`deploy/medplum-lab`](deploy/medplum-lab/README.md) reproduces that run. A local server is not a hosted vendor sandbox, and Oracle Health was not tested yet.

## Patient access policy

Every tool checks the caller before any FHIR request and denies by default. A grant is an exact match of principal, patient and tool, loaded from `PATIENT_POLICY_FILE` (see [`patient-policy.example.json`](patient-policy.example.json)). A grant may carry `expires_at` (ISO 8601 with a time zone, for example `2027-01-31T00:00:00Z`); once that time passes the grant is treated as absent, checked on every call. An invalid policy file stops the server at startup. A denial returns `Patient access not authorized` and writes one audit record with `patient_not_authorized`.

| Mode | Where the principal comes from | Default |
|---|---|---|
| Standalone stdio | `LOCAL_SYNTHETIC_PRINCIPAL`, a labelled local fixture. It is not authenticated | Every call denied |
| Kubernetes gateway | The verified SPIFFE mTLS peer, already matched to the token subject | One synthetic grant in the gateway |

`CALLER_IDENTITY` remains an audit label and never grants access. Tool arguments cannot supply an identity or a grant. This is a local policy for the prototype, not SMART authorization or clinical consent; a compromised caller can still misuse the patients it is granted.

Use synthetic patient ids only. To try the sandbox, copy the example, put a sandbox patient id in `patients`, and set both variables.

## Audit log integrity and key rotation

Every audit record carries `chain_id` (one per process start), `seq`, `prev` and `mac`. `mac` is an HMAC-SHA-256 of the record under `AUDIT_HMAC_KEY`, and `prev` is the `mac` of the record before it. To check a log file:

```fish
pnpm build
AUDIT_HMAC_KEY=<key> node scripts/verify-audit.mjs /path/to/audit.jsonl
```

It reports an edited record, and a record removed from or repeated inside a chain, and exits non-zero. It prints counts only. Limits: records cut from the end of a chain and a whole removed chain are not detected, and anyone holding the key can re-sign a log. Ship the log to append-only storage for those cases.

To rotate the key: start the server with a new `AUDIT_HMAC_KEY`. New records get a new `key_id` and a new chain. Keep the old key in your secrets manager for as long as the old records are retained, and verify them with it; records under another key or without chain fields are counted as skipped. A skipped record is not verified, so anyone able to append to the file could add one: pass `--strict` to fail on every skipped record when the log should hold a single key. The same patient hashes differently under the new key, so cross-referencing a patient across the rotation needs both keys.

## Install in Claude Desktop

Two paths. The local extension bundle installs natively in Claude Desktop; this was verified on 2026-10-13. The manual config is for active development.

### Option A: native extension (`.mcpb`)

1. Build a local bundle with `pnpm package:mcpb` (requires Python 3 for the archive gate). This prepares a file without publishing a release. An existing bundle is not overwritten.
2. In Claude Desktop: `Settings -> Extensions -> Install Extension...` and select the file.
3. The form prompts for FHIR base URL, caller identity, audit HMAC key (required), audit log file path, patient policy file and local synthetic principal. Without the last two, every tool call is denied. The HMAC key is stored encrypted via your OS keychain. Generate one with `openssl rand -hex 32`. The other three have working defaults for the public sandbox.
4. Restart Claude Desktop. The tools appear in the tools menu under `hipaa-fhir-mcp`.

Claude Desktop's built-in Node runtime is 24.x. The manifest requires Node 26 or newer, so Desktop runs the server with the system Node 26 found on its `PATH`. Install Node 26 system-wide before installing the extension.

Reinstalling a bundle with the same id and version does not replace the installed files. Uninstall the extension first, then install the new bundle.

Native installation was verified on 2026-10-13 on macOS: the extension connected with three tools, `get_patient` against the public SMART sandbox returned a synthetic patient, and the audit record contained only `patient_id_hmac`, with caller_identity `claude-desktop-local`. See the [bundle checks](docs/publication-readiness.md#desktop-bundle-checks).

### Option B: manual config (development)

For a step-by-step walkthrough that takes the prototype from a clean clone through MCP Inspector to a working Desktop session, with a live audit-log trace and a no-PHI verification, see [`docs/demo.md`](docs/demo.md).

Minimal config: add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Replace the absolute paths with values from your machine:

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
        "CALLER_IDENTITY": "claude-desktop-local",
        "AUDIT_HMAC_KEY": "<paste-output-of-openssl-rand-hex-32>",
        "NODE_ENV": "development",
        "AUDIT_LOG_FILE": "/absolute/path/to/hipaa-fhir-mcp/audit-claude.log",
        "PATIENT_POLICY_FILE": "/absolute/path/to/patient-policy.json",
        "LOCAL_SYNTHETIC_PRINCIPAL": "local-synthetic-operator"
      }
    }
  }
}
```

Use absolute paths. macOS GUI apps do not always inherit your shell `PATH`, so a bare `node` may not resolve. Run `which node` (and follow with `readlink -f` if you use a version manager) and paste the result into `command`.

Build first: `pnpm install && pnpm build` so `dist/server.js` exists.

Restart Claude Desktop. The tools appear under the server name in the tools menu.

## Install in Claude Code

Build first (`pnpm install && pnpm build`), then register the stdio server. Use an absolute path to `dist/server.js` and to a Node 26 binary if your shell resolves an older one.

```sh
claude mcp add hipaa-fhir-mcp \
  -e FHIR_BASE_URL=https://r4.smarthealthit.org \
  -e CALLER_IDENTITY=claude-code-local \
  -e AUDIT_HMAC_KEY=<output-of-openssl-rand-hex-32> \
  -e NODE_ENV=development \
  -- node /absolute/path/to/hipaa-fhir-mcp/dist/server.js
```

The default scope is local to the current project. Add `-s user` to make it available in every project. `claude mcp list` shows whether the server connected; inside a session, `/mcp` lists its three tools.

## Install in Codex

Codex reads MCP servers from `~/.codex/config.toml` (or a trusted project's `.codex/config.toml`); the CLI and the IDE extension share it. Either run:

```sh
codex mcp add hipaa-fhir-mcp \
  --env FHIR_BASE_URL=https://r4.smarthealthit.org \
  --env CALLER_IDENTITY=codex-local \
  --env AUDIT_HMAC_KEY=<output-of-openssl-rand-hex-32> \
  --env NODE_ENV=development \
  -- node /absolute/path/to/hipaa-fhir-mcp/dist/server.js
```

or add the table by hand:

```toml
[mcp_servers.hipaa-fhir-mcp]
command = "node"
args = ["/absolute/path/to/hipaa-fhir-mcp/dist/server.js"]

[mcp_servers.hipaa-fhir-mcp.env]
FHIR_BASE_URL = "https://r4.smarthealthit.org"
CALLER_IDENTITY = "codex-local"
AUDIT_HMAC_KEY = "<output-of-openssl-rand-hex-32>"
NODE_ENV = "development"
```

`/mcp` in the Codex TUI shows the active servers. See the [Codex MCP documentation](https://developers.openai.com/codex/mcp) for options.

In every client the HMAC key ends up in a local config file. Keep that file private, use a key that exists only for this demo, and point `FHIR_BASE_URL` only at synthetic data.

## MCP Registry

[`server.json`](server.json) describes the released Desktop bundle for the [official MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.tanya-ok/hipaa-fhir-mcp`. It points at the `.mcpb` asset of a GitHub release and pins its SHA-256, so no npm package is needed. On each release, update `version`, the asset URL and `fileSha256` from the release's `.sha256` file, then publish with `mcp-publisher login github` and `mcp-publisher publish`. The registry does not review servers; a listing is not a security or compliance claim.

This server is not submitted to the Claude Directory. It is a prototype on synthetic data, and a public directory listing for a HIPAA-named server would read as production readiness.

## Production deployment notes

A production deployment replaces the sandbox with AWS HealthLake and the stubs with real implementations. A sketch:

- **Runtime**: EKS pod or Fargate task in a private VPC subnet with no IGW route.
- **Workload identity**: SPIRE Agent DaemonSet issues X.509 SVIDs over the Workload API socket. The pod SecurityContext mounts the socket read-only. `src/security/spiffe.ts` gets a gRPC Workload API client.
- **User identity**: SMART-on-FHIR OAuth 2.1 + PKCE flow wired into `src/security/oauth.ts`. Access token passes in the `Authorization: Bearer` header; scopes bind the clinical context (`patient/*.rs`).
- **Data path**: VPC interface endpoint for HealthLake (`com.amazonaws.eu-west-1.healthlake`). Endpoint policy restricts calls to the specific datastore ARN. Egress security group allows only the endpoint ENI.
- **Encryption at rest**: any response cache goes through `src/security/kms.ts` (KMS envelope encryption with AES-256-GCM). CMK key policy grants `kms:Decrypt` only to the workload's IAM role, with `kms:EncryptionContext` binding tied to `patient_id_hmac`. Decrypts that do not match the expected context fail closed.
- **Audit trail**: stderr -> collector Logs, 2-year retention, metric filter on `status=error` into an alarm. CloudTrail captures `KMS.Decrypt` and `healthlake:ReadResource` for cross-reference.
- **Transport to the MCP host**: MCP over stdio works inside the pod. For a remote MCP transport, terminate TLS at an Envoy sidecar with mTLS between Envoy and peers using the SPIFFE SVID.
- **BAA**: required with AWS (HealthLake, KMS, CloudWatch) and with any LLM provider that sees tool outputs. The prototype does not talk to any LLM directly.

The full control-by-control table is in [`docs/hipaa-compliance-mapping.md`](docs/hipaa-compliance-mapping.md).

## Project layout

```
hipaa-fhir-mcp/
├── src/
│   ├── server.ts              # stdio entry point
│   ├── http-server.ts         # Streamable HTTP entry point
│   ├── http.ts                # HTTP transport: tokens, demo mode, rate limit
│   ├── mcp.ts                 # transport-independent MCP server factory
│   ├── stdio.ts               # stdio transport that audits pre-handler rejections
│   ├── config.ts              # zod-validated env, fails fast
│   ├── audit/
│   │   └── logger.ts          # structured audit log, keyed HMAC-SHA-256 id hashing
│   ├── fhir/
│   │   ├── client.ts          # HTTPS FHIR client (swappable for HealthLake)
│   │   ├── schemas.ts         # bounded response schemas, shared patient id schema
│   │   └── types.ts           # minimal FHIR R4 types
│   ├── tools/
│   │   ├── types.ts
│   │   ├── access.ts          # policy check shared by the tools
│   │   ├── get-patient.ts
│   │   ├── search-observations.ts
│   │   ├── get-medication-list.ts
│   │   └── patient-records.ts # summary, conditions, allergies, immunizations, encounters, find
│   └── security/
│       ├── context.ts         # per-request caller context
│       ├── patient-policy.ts  # deny-by-default patient and tool grants
│       ├── smart-backend.ts   # SMART Backend Services client assertion and token cache
│       ├── oauth.ts           # SMART-on-FHIR OAuth 2.1 + PKCE stub
│       ├── spiffe.ts          # SPIFFE Workload API stub
│       └── kms.ts             # KMS envelope encryption stub
├── tests/                     # vitest suites, synthetic fixtures only
│   ├── fixtures/stdio-http.ts
│   ├── client.test.ts
│   ├── config.test.ts
│   ├── http.test.ts
│   ├── mcp.test.ts
│   ├── patient-policy.test.ts
│   ├── patient-records.test.ts
│   ├── smart-backend.test.ts
│   ├── stdio.test.ts
│   └── tools.test.ts
├── scripts/
│   ├── check-phi.mjs          # PHI shape sweep
│   ├── package-mcpb.mjs       # gated Desktop bundle packer
│   ├── check-mcpb.py          # bundle payload gate
│   ├── test-mcpb.py           # payload gate cases
│   ├── demo-package.mjs       # installed-package stdio demo
│   └── smoke-live.mjs         # live smoke test of every tool, prints no clinical content
├── deploy/medplum-lab/        # local Medplum to run the live smoke test against
├── deploy/kubernetes/         # shared lab gateway and probe (not standalone)
├── docs/                      # documentation site sources (Zensical)
├── .github/                   # workflows, Dependabot, templates
├── manifest.json              # Claude Desktop extension manifest
├── Dockerfile
├── zensical.toml
├── package.json
└── README.md
```

## Security automation

This repository runs the following automated checks on every push and pull request, plus a weekly schedule for the static-analysis job:

| Check | What it does | Workflow |
|---|---|---|
| Typecheck / test / build | Catches broken code. | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| Biome lint + format check (`pnpm check`) | Enforces code style and catches a baseline of correctness rules. | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| `pnpm audit --audit-level moderate` | Fails on `moderate` or higher dependency vulnerabilities. | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| PHI sweep | Scans the working tree for SSN-, US-phone-, and non-allowlisted-email shapes. Enforces the no-PHI claim made elsewhere in this repo. | [`scripts/check-phi.mjs`](scripts/check-phi.mjs) |
| CodeQL | GitHub-native static analysis for JS/TS with the `security-extended` query pack. | [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) |
| gitleaks | Full-history secret-shape scan on every push and pull request, using a checksum-verified release. | [`.github/workflows/gitleaks.yml`](.github/workflows/gitleaks.yml) |
| Release | Tag builds re-run the gates, require the tag on `main` with matching versions, pack with the gated packer and create a draft release. | [`.github/workflows/release.yml`](.github/workflows/release.yml) |
| Dependabot | Weekly grouped PRs for the npm (reads `pnpm-lock.yaml`), GitHub Actions, and Docker ecosystems. Security alerts open ad-hoc. | [`.github/dependabot.yml`](.github/dependabot.yml) |

Actions are pinned to full commit SHAs, checkouts do not persist credentials and write permissions are job-scoped.

What the PHI sweep catches and explicitly does not catch is in [`docs/security-automation.md`](docs/security-automation.md).

## Versioning

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are tagged `vX.Y.Z` and tracked in [`CHANGELOG.md`](CHANGELOG.md).

While the project is **pre-1.0**, the public surface (MCP tool signatures, audit record schema, environment variable names, CLI flags) may change in any minor release. Pin to an exact version or commit SHA for reproducibility.

| Change type | Pre-1.0 bump | Post-1.0 bump |
|---|---|---|
| Bug fix, dependency bump, doc-only change | patch | patch |
| New MCP tool, new optional env var, additive audit field | minor | minor |
| MCP tool removed or renamed, audit schema field removed or renamed, env var renamed, breaking config change | minor | major |

Schema-level changes are also called out in the changelog under a `### Changed` or `### Removed` heading so a downstream consumer can spot them at a glance.

## License

MIT. See [LICENSE](LICENSE).
