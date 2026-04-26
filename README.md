# hipaa-fhir-mcp

A production-grade **prototype** of a HIPAA-oriented MCP server that lets an AI agent query medical data through the FHIR R4 API.

The goal is to show the intersection of four things that rarely appear in the same repository:
- Model Context Protocol (MCP) tool server in TypeScript
- HIPAA Technical Safeguards (§164.312)
- AWS security patterns (IAM, VPC endpoints, KMS envelope encryption)
- FHIR R4 with a SMART-on-FHIR OAuth 2.1 + PKCE upgrade path

## Why this exists

AI agents are increasingly given direct access to data systems through MCP. In healthcare, that data is regulated and the required controls are specific: HIPAA §164.312 names them. Most public MCP examples ignore the regulatory context; most HIPAA write-ups predate AI agents.

This repository sits at that intersection. It is a working scaffold that lets an engineer see, in one place:

- which Technical Safeguards a HIPAA-aligned MCP server actually needs,
- which ones live in code, which live in infrastructure, and which are organizational policy,
- what the production path looks like when the prototype's stubs become real implementations.

The point is not to ship a compliant system. The point is to make the gap between "MCP demo" and "HIPAA-compliant deployment" concrete enough to discuss. The full gap list is in [`docs/hipaa-compliance-mapping.md`](docs/hipaa-compliance-mapping.md).

## HIPAA scope statement

| | |
|---|---|
| **In scope** | §164.312(a)(2)(iv) encryption, §164.312(b) audit controls (structured JSON, SHA-256 patient id hashing, no PHI in logs), §164.312(e) transmission security (TLS), and stubs for the production path: SMART OAuth 2.1 + PKCE, SPIFFE SVID workload identity, KMS envelope encryption. |
| **Not in scope** | Administrative and Physical safeguards - those are organizational controls. A real BAA with AWS and any downstream LLM provider. Production SMART/SPIFFE/KMS wiring (stubs only). |
| **Data** | Public, synthetic sandbox at `https://r4.smarthealthit.org`. **No PHI** is ever touched by this prototype. |

The prototype deliberately does not ship with fake production posture. Treating it as compliant out of the box would itself be non-compliant.

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
     │  │ tools/     │  │ audit/logger  │──┼──► stdout → CloudWatch
     │  │            │  │ (SHA-256 id)  │  │
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

The three MCP tools exposed to Claude:

| Tool | Input | Returns |
|---|---|---|
| `get_patient` | `patient_id` | `Patient` resource |
| `search_observations` | `patient_id`, `code` (e.g. `http://loinc.org\|8867-4`) | `Observation[]` |
| `get_medication_list` | `patient_id` | `MedicationRequest[]` |

Every invocation emits a structured audit record:

```json
{
  "timestamp": "2026-04-21T10:15:03.123Z",
  "tool": "get_patient",
  "patient_id_hash": "9b74c9897bac770ffc029102a200c5de...",
  "caller_identity": "local-dev",
  "request_id": "a3e1...",
  "status": "success"
}
```

`patient_id` is never written to any log - only its SHA-256 hash.

## Requirements

- Node.js 25+
- pnpm 10 (Corepack picks up the version pinned in `package.json`; run `corepack enable` once if you have not already)

## Install

```fish
cd hipaa-fhir-mcp
pnpm install
cp .env.example .env   # tweak AUDIT_LOG_FILE, CALLER_IDENTITY if you want
```

## Run locally

```fish
# One-shot, no build needed:
pnpm dev

# Or directly:
pnpm exec tsx src/server.ts
```

The server talks MCP over stdio. To exercise it from a terminal, use the MCP Inspector:

```fish
pnpm dlx @modelcontextprotocol/inspector pnpm exec tsx src/server.ts
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
```

## Install in Claude Desktop

Two paths. The native extension is the right choice for end users; the manual config is for active development.

### Option A: native extension (`.mcpb`)

1. Download `hipaa-fhir-mcp-X.Y.Z.mcpb` from the [latest release](https://github.com/tanya-ok/hipaa-fhir-mcp/releases/latest).
2. In Claude Desktop: `Settings -> Extensions -> Install Extension...` and select the file.
3. The form prompts for three values: FHIR base URL, caller identity, audit log file path. Defaults work for the public sandbox; only the audit log file path needs an absolute path of your choice.
4. Restart Claude Desktop. The three tools appear in the tools menu under `hipaa-fhir-mcp`.

The extension uses Claude Desktop's bundled Node runtime, so no system-level Node install is required.

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
        "NODE_ENV": "development",
        "AUDIT_LOG_FILE": "/absolute/path/to/hipaa-fhir-mcp/audit-claude.log"
      }
    }
  }
}
```

Use absolute paths. macOS GUI apps do not always inherit your shell `PATH`, so a bare `node` may not resolve. Run `which node` (and follow with `readlink -f` if you use a version manager) and paste the result into `command`.

Build first: `pnpm install && pnpm build` so `dist/server.js` exists.

Restart Claude Desktop. The three tools appear under the server name in the tools menu.

## Production deployment notes

A production deployment replaces the sandbox with AWS HealthLake and the stubs with real implementations. A sketch:

- **Runtime**: EKS pod or Fargate task in a private VPC subnet with no IGW route.
- **Workload identity**: SPIRE Agent DaemonSet issues X.509 SVIDs over the Workload API socket. The pod SecurityContext mounts the socket read-only. `src/security/spiffe.ts` gets a gRPC Workload API client.
- **User identity**: SMART-on-FHIR OAuth 2.1 + PKCE flow wired into `src/security/oauth.ts`. Access token passes in the `Authorization: Bearer` header; scopes bind the clinical context (`patient/*.rs`).
- **Data path**: VPC interface endpoint for HealthLake (`com.amazonaws.eu-west-1.healthlake`). Endpoint policy restricts calls to the specific datastore ARN. Egress security group allows only the endpoint ENI.
- **Encryption at rest**: any response cache goes through `src/security/kms.ts` (KMS envelope encryption with AES-256-GCM). CMK key policy grants `kms:Decrypt` only to the workload's IAM role, with `kms:EncryptionContext` binding tied to `patient_id_hash`.
- **Audit trail**: stdout → CloudWatch Logs, 2-year retention, metric filter on `status=error` into an alarm. CloudTrail captures `KMS.Decrypt` and `healthlake:ReadResource` for cross-reference.
- **Transport to the MCP host**: MCP over stdio works inside the pod. For a remote MCP transport, terminate TLS at an Envoy sidecar with mTLS between Envoy and peers using the SPIFFE SVID.
- **BAA**: required with AWS (HealthLake, KMS, CloudWatch) and with any LLM provider that sees tool outputs. The prototype does not talk to any LLM directly.

The full control-by-control table is in [`docs/hipaa-compliance-mapping.md`](docs/hipaa-compliance-mapping.md).

## Project layout

```
hipaa-fhir-mcp/
├── src/
│   ├── server.ts              # MCP server entry point (stdio transport)
│   ├── config.ts              # zod-validated env, fails fast
│   ├── audit/
│   │   └── logger.ts          # structured audit log, SHA-256 id hashing
│   ├── fhir/
│   │   ├── client.ts          # HTTP FHIR client (swappable for HealthLake)
│   │   └── types.ts           # minimal FHIR R4 types
│   ├── tools/
│   │   ├── types.ts
│   │   ├── get-patient.ts
│   │   ├── search-observations.ts
│   │   └── get-medication-list.ts
│   └── security/
│       ├── oauth.ts           # SMART-on-FHIR OAuth 2.1 + PKCE stub
│       ├── spiffe.ts          # SPIFFE Workload API stub
│       └── kms.ts             # KMS envelope encryption stub
├── tests/
│   └── tools.test.ts          # unit tests with stub FHIR client
├── docs/
│   └── hipaa-compliance-mapping.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Security automation

This repository runs the following automated checks on every push and pull request, plus a weekly schedule for the static-analysis job:

| Check | What it does | Workflow |
|---|---|---|
| Typecheck / test / build | Catches broken code. | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| `pnpm audit --audit-level moderate` | Fails on `moderate` or higher dependency vulnerabilities. | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| PHI sweep | Scans the working tree for SSN-, US-phone-, and non-allowlisted-email shapes. Enforces the no-PHI claim made elsewhere in this repo. | [`scripts/check-phi.mjs`](scripts/check-phi.mjs) |
| CodeQL | GitHub-native static analysis for JS/TS with the `security-extended` query pack. | [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) |
| gitleaks | Full-history secret-shape scan on every push and pull request. | [`.github/workflows/gitleaks.yml`](.github/workflows/gitleaks.yml) |
| Dependabot | Weekly grouped PRs for the npm (reads `pnpm-lock.yaml`), GitHub Actions, and Docker ecosystems. Security alerts open ad-hoc. | [`.github/dependabot.yml`](.github/dependabot.yml) |

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

MIT.
