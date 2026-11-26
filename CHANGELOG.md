# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the project is pre-1.0, breaking changes may occur in any minor release. See the [Versioning](README.md#versioning) section of the README for the policy.

## [Unreleased]

### Added

- Six read-only tools: `get_procedures`, `get_diagnostic_reports`, `get_lab_results`, `get_vital_signs` (each with an optional `since` date), `get_care_team` and `get_goals`. Each needs its own grant in the patient policy and writes one audit record. Narrative conclusions, attachments, care team members and free text are not returned.
- Observations now include coded `interpretation` and panel `component` values.
- The default SMART scope also requests `Procedure`, `DiagnosticReport`, `CareTeam` and `Goal`.

### Changed

- The registry title in `server.json` is now `HIPAA FHIR MCP`; the description still states synthetic data only.

## [0.8.1] - 2026-11-26

### Changed

- `SMART_TOKEN_URL` is now required with SMART Backend Services unless `NODE_ENV` is `development` or `test`; an unset `NODE_ENV` no longer allows token endpoint discovery.

### Fixed

- `scripts/verify-audit.mjs` reports a log line that is not a JSON object as a problem instead of stopping.

### Added

- `deploy/medplum-lab`: a local Medplum with a seed script to run the live smoke test against a second FHIR server over SMART Backend Services.

## [0.8.0] - 2026-11-26

### Added

- Patient grants accept an optional `expires_at`; an expired grant is treated as absent.
- Audit records are chained: each carries `chain_id`, `seq`, `prev` and `mac`. `scripts/verify-audit.mjs` checks a log file and reports an edited, removed or repeated record; `--strict` also fails on records under another key or without chain fields.
- `scripts/smoke-live.mjs` covers `find_patient` when `SMOKE_IDENTIFIER` is set.
- Docs: data flow, threat model and a guide to deploying inside a HIPAA program.

### Changed

- With `NODE_ENV=production` and SMART Backend Services, `SMART_TOKEN_URL` is required; token endpoint discovery remains for development and test. The container image sets `NODE_ENV=production`.

### Fixed

- Search results from servers that add `OperationOutcome` entries marked `search.mode: outcome` (for example Epic) no longer fail the call. All nine tools pass against the Epic sandbox.
- The HTTP rate limiter keeps other clients' counters when its table is full.

## [0.7.1] - 2026-11-25

### Added

- `MCP_CLIENT_IP_HEADER`: rate limit by the client address a trusted proxy sets (for example `Fly-Client-IP`) instead of the proxy's own address.
- `deploy/demo/fly.toml` for the public synthetic demo on Fly.io.

## [0.7.0] - 2026-11-25

### Added

- Five read-only tools: `get_patient_summary` (patient, active conditions, allergies and active medications in one call), `get_conditions`, `get_allergies`, `get_immunizations` and `get_encounters` with an optional `since` date. Each needs its own grant in the patient policy and writes one audit record.
- `find_patient`: look up patients by identifier (system|value); only matches inside the caller's `find_patient` grant are returned, and a caller without that grant is refused before any FHIR request. The identifier is not logged.
- SMART Backend Services client authentication: `client_credentials` with a `private_key_jwt` assertion (RS384 or ES384), token endpoint discovery, token caching, and one retry with a new token after a 401. Configured with `SMART_CLIENT_ID`, `SMART_KEY_ID` and `SMART_PRIVATE_KEY_FILE`; the key file must be mode 600 and is read through one no-follow descriptor.
- `hipaa-fhir-mcp-http`: Streamable HTTP transport (stateless) with SHA-256-hashed bearer tokens mapped to policy principals, or a public demo mode pinned to the synthetic SMART sandbox; health endpoint, per-address rate limit, 64 KB body limit, optional Host pinning, and audited rejection of invalid tool calls.
- Release workflow `image.yml`: multi-arch image on GHCR with SBOM and provenance attestations, keyless cosign signature, and a tools smoke test on the pushed digest.
- `deploy/demo/`: a public demo image recipe pinned to the synthetic sandbox and five synthetic patients; `scripts/smoke-live.mjs` calls every tool against any configured FHIR server without printing clinical content.
- Audit records carry `key_id`, a one-way label of the HMAC key, so records stay attributable after the key is rotated.
- README: a header with badges and the Glama card, a table mapping each security claim to the test that pins it, and a "Where it falls short" section.

### Changed

- An over-limit search returns "Too many results (more than 200); narrow the request" instead of the generic failure text.
- The base image is pinned by digest. The image entry point is `node` with `dist/server.js` as the default command, so `dist/http-server.js` can be passed instead.
- `typecheck` also checks the tests.

## [0.6.0] - 2026-11-24

### Added

- MCP tool annotations (read only, not destructive, idempotent, open world) and parameter descriptions; each tool description now states when to use it, its result limit, the patient access check and the fixed error texts.
- `PATIENT_POLICY_FILE` and `LOCAL_SYNTHETIC_PRINCIPAL` in `server.json`, so MCP Registry clients see the patient policy settings.
- A CI job that builds the container image and lists the tools over stdio inside it.

### Fixed

- The container build copies `pnpm-workspace.yaml`, so the frozen install accepts the lockfile overrides.

### Security

- **Breaking:** per-patient authorization before any FHIR request. Tools deny by default until `PATIENT_POLICY_FILE` and, for stdio, `LOCAL_SYNTHETIC_PRINCIPAL` are set; `createFhirMcpServer` now takes an authorizer and a request context provider. An invalid policy stops startup. This is a local policy, not SMART authorization.

## [0.5.0] - 2026-11-24

### Added

- A release workflow step that publishes `server.json` to the official MCP Registry when a GitHub release is published, with the bundle checksum verified and GitHub OIDC login.
- Install instructions for Claude Code and Codex, and a `server.json` that lists the released Desktop bundle in the official MCP Registry.

### Changed

- Moved vitest from 4.1.12 to 5.0.5 and Biome from 2.5.14 to 2.6.3. The test suite needed no changes. Biome 2.6 formats Markdown and YAML by default; the Markdown and YAML formatters are turned off and `pnpm-lock.yaml` is excluded, while the Markdown and YAML linters stay on.

### Fixed

- The Desktop bundle build copies `pnpm-workspace.yaml` into its staging folder, so the frozen production install accepts the lockfile overrides, and removes it before packing.
- The stdio test reads the expected server version from `package.json`.

### Security

- Updated transitive `hono` and `@hono/node-server` through the MCP SDK; `pnpm audit --audit-level moderate` is clean.
- Moved zod from 3.25.76 to 4.6.7 to address GHSA-mrhx-c7xc-m3w5, which has no fixed 3.x release. Configuration validation uses the zod 4 URL, custom issue and error flattening APIs.

## [0.4.0] - 2026-10-13

### Added


- Transport-independent MCP server factory (`src/mcp.ts`) with a request-local caller identity provider, and a shared Kubernetes gateway (`deploy/kubernetes/fhir-gateway.mjs`) that serves the three tools over SPIRE mTLS with resource-bound OAuth and verified SPIFFE caller identity. The gateway uses an offline synthetic fixture and depends on the sibling `mcp-svid-auth` lab; it is not standalone.
- Kubernetes probe (`deploy/kubernetes/probe_fhir.py`) that requires explicit certificate-denial alerts.
- Audited stdio transport (`src/stdio.ts`): schema rejections and unknown-tool calls are audited once before SDK dispatch with fixed labels.
- Bounded FHIR response schemas (`src/fhir/schemas.ts`) and a shared `PatientIdSchema` used by the tools and the client.
- Gated Desktop bundle packer (`pnpm package:mcpb [output]`): stages only compiler-reported runtime files and locked production dependencies, packs with MCPB 2.1.2, runs the ZIP payload gate (`scripts/check-mcpb.py`, cases in `pnpm check:mcpb`) and never overwrites an existing bundle.
- Installed-package demo over real stdio and verified local HTTPS (`scripts/demo-package.mjs`).
- Zensical documentation site with a GitHub Pages workflow, a demonstration guide, a visual overview, and light and dark palettes.
- Development plan, publication-readiness gates and dated local evidence, including native Claude Desktop installation verified on 2026-10-13.
- `.nvmrc`, `.editorconfig`, `CONTRIBUTING.md`, `CODEOWNERS`, pull request and issue templates; package metadata (author, repository, homepage, bugs, keywords).

### Changed

- **BREAKING:** Audit records moved from stdout to stderr. Stdout carries MCP JSON-RPC only.
- **BREAKING:** Tool responses are projected to allowlisted fields. Names, narrative, display text, notes, identifiers and extensions are dropped; inactive medication requests are filtered.
- **BREAKING:** `FHIR_BASE_URL` is required when `NODE_ENV` is omitted, in production, and whenever `FHIR_AUTH_TOKEN` is set. It must be HTTPS without credentials, query or fragment.
- **BREAKING:** `AUDIT_HMAC_KEY` must be exactly 64 hex characters; production refuses a key of one repeated character, such as the `.env.example` demo key.
- **BREAKING:** `patient_id` is limited to 64 characters and rejects `.` and `..` in every tool, matching the client.
- `AUDIT_LOG_FILE` is honoured in every mode, including production. Stderr remains the default and the fallback; production never requires a file.
- Search follows same-base continuation links only, up to five pages, 200 resources and 1 MiB per page; redirects are disabled.
- Release workflow split into a read-only build job and a draft publish job. The build verifies the tag is on `main`, matches `package.json` and `manifest.json`, and packs with the gated packer.
- Server metadata reports the package version. The manual Desktop config uses the compiled entry point.
- MCP SDK floor raised to 1.32.1. `uuid` replaced with `node:crypto` `randomUUID`.
- Node.js 26 everywhere: Docker base image, CI and release workflows, `engines`, and the `.mcpb` manifest.
- Dependencies updated within their major versions: `@modelcontextprotocol/sdk`, `axios`, `@biomejs/biome`, `@types/node` 26, `tsx`, `vitest`.

### Fixed

- Fixed tool errors no longer return upstream paths or exception text.
- Docker build: Node 25+ images no longer bundle Corepack, so `corepack enable` failed. The build installs Corepack 0.36.0 first.
- CI and release workflows: `corepack enable` replaced with `pnpm/action-setup`, which reads the pinned `packageManager`.

### Security

- The FHIR client ignores environment proxies (`proxy: false`), so the backend bearer token reaches only the configured origin.
- Every workflow pins actions to full commit SHAs, checks out without persisted credentials, sets job timeouts and scopes write permissions to the job that needs them. Gitleaks 8.30.1 is verified against its SHA-256 before use.
- `source-map-js` overridden to `>=1.2.2` for GHSA-68fv-2mgg-jv7q (development dependency via vitest).
- Lockfile refresh clears all 65 open Dependabot alerts (`axios`, `hono`, `fast-uri`, `vite`, `qs`, `form-data` and others). `pnpm audit` is clean.

## [0.3.0] - 2026-04-26

The 0.2.0 tag was created but never published as a release; 0.3.0 is the first artifact-attached release. It bundles the original 0.2.0 scope (pnpm migration, demo walkthrough, `.mcpb` distribution, Dockerfile NODE_ENV cleanup) with the audit-invariant upgrade to keyed HMAC.

### Added


- `manifest.json`: Claude Desktop Extension (MCPB) manifest. Declares the three tools, the Node entry point, and four `user_config` fields (FHIR base URL, caller identity, audit HMAC key, audit log file path). Lets a non-developer install the prototype via `Settings -> Extensions -> Install Extension...` without editing `claude_desktop_config.json`. The HMAC key field is marked `sensitive: true` so Desktop encrypts it via the OS keychain.
- `.github/workflows/release.yml`: tag-triggered release workflow. On `v*` tag push, runs typecheck/test/build/lint/PHI-sweep, prunes dev dependencies, validates the manifest, packs the `.mcpb` artifact, and publishes a GitHub release with the artifact attached and auto-generated notes.
- `pnpm package:mcpb` script: local sanity check that builds and packs the extension. Output is fat locally because dev dependencies remain installed; the CI workflow produces the slim release artifact.
- `docs/demo.md`: end-to-end walkthrough that takes the prototype from a clean clone through MCP Inspector to a working Claude Desktop session, with a live audit-log trace and a no-PHI verification step. Linked from the README.
- `biome.json` + `@biomejs/biome` dev dependency: lint and format with Biome (no ESLint, no Prettier). New scripts `pnpm lint`, `pnpm format`, `pnpm check`, `pnpm check:fix`. CI workflow now runs `pnpm check` ahead of the rest of the matrix.
- New unit test asserting the audit HMAC depends on the configured key.

### Changed

- **BREAKING:** Audit logger now uses keyed HMAC-SHA-256 with a server-side secret instead of plain SHA-256. Audit record field renamed `patient_id_hash` -> `patient_id_hmac`. The `AuditInput` interface no longer carries a pre-hashed value: tools pass the raw `patient_id` and the logger hashes at the boundary, so no code path can bypass hashing. Plain SHA-256 was reversible by enumeration when ids were small or predictable; the keyed HMAC closes that gap. Plaintext patient ids still never leave the logger.
- **BREAKING:** New required env var `AUDIT_HMAC_KEY` (string, 32+ chars). Server fails fast on startup if missing or too short. The included `.env.example` ships a demo-only zero-key so the prototype runs against the public synthetic sandbox out of the box; production deployments source the real key from a secrets manager (Secrets Manager / Vault / KMS-derived).
- Package manager: migrated from npm to pnpm. `pnpm-lock.yaml` is now the committed lockfile; `package-lock.json` removed. The pnpm version is pinned via the `packageManager` field and resolved through Corepack. Dockerfile, CI workflow, and Dependabot configuration updated. README, AGENTS.md, and `docs/security-automation.md` use pnpm commands.
- `package.json` `packageManager` now carries an SHA-512 integrity hash (`pnpm@10.33.2+sha512.a90faf...`). Corepack verifies the downloaded pnpm tarball before activating it.
- Dockerfile build stage declares `ENV NODE_ENV=development` before install so dev dependencies install deterministically; switches to `ENV NODE_ENV=production` before `pnpm prune --prod`. Runtime stage gains a comment block explaining that the audit logger writes to stdout when `NODE_ENV=production`.
- Dependabot configuration: each ecosystem (npm reads `pnpm-lock.yaml`, GitHub Actions, Docker) now produces at most one routine PR per week, bundling every update-type into a single group. Security advisories still open ad-hoc PRs.
- TypeScript and zod major-version bumps are excluded from automatic Dependabot PRs and must be tackled deliberately. Documented in `.github/dependabot.yml`.
- README "Connect to Claude Desktop" section restructured into "Install in Claude Desktop" with Option A (native `.mcpb` extension, recommended) and Option B (manual config for development). Audit-record example, scope statement, architecture diagram, and HIPAA mapping all updated for the HMAC change.

### Removed

- Free function `hashPatientId` exported from `src/audit/logger.ts`. Hashing is now a method on `AuditLogger` (`audit.hmac(id)`); the only legitimate path to the digest is through the logger that owns the key.

## [0.1.2] - 2026-04-26

### Added


- CodeQL workflow with the `security-extended` query pack for JavaScript/TypeScript (`.github/workflows/codeql.yml`).
- gitleaks workflow scanning the full git history on every push and pull request (`.github/workflows/gitleaks.yml`).
- Dependabot configuration with weekly grouped PRs for npm, GitHub Actions, and Docker base images, plus ad-hoc PRs from security advisories (`.github/dependabot.yml`).
- `npm audit --audit-level=moderate` step in CI to fail-fast on dependency regressions.
- PHI sweep script (`scripts/check-phi.mjs`) that scans the working tree for SSN-, US-phone-, and non-allowlisted-email shapes. Run via `npm run check:phi` and on every CI run. Enforces the no-PHI claim for the patterns it covers.
- `docs/security-automation.md` documenting what the PHI sweep catches and explicitly does not catch, plus the repo-settings checklist.
- README "Security automation" section indexing the above.
- `npm run audit` and `npm run check:phi` scripts.

## [0.1.1] - 2026-04-26

### Security

- Bump `uuid` from `11.x` to `14.x` to address the missing buffer-bounds-check in `v3`/`v5`/`v6` when a buffer is provided. The repo only calls `v4`, so the issue was not exploitable in the current code; bumped anyway to clear the alert.
- Bump `vitest` from `2.x` to `4.x`, which pulls in patched `vite`, `vite-node`, `@vitest/mocker`, and `esbuild`. Resolves the path-traversal alert in `vite` (Optimized Deps `.map` handling) and the dev-server origin-bypass alert in `esbuild`. Both are dev-only and not on the production runtime path; alerts are now closed.

### Removed

- `@types/uuid` (unused; `uuid` v9+ ships its own type declarations).

## [0.1.0] - 2026-04-26

### Added


- MCP server entry point over stdio (`src/server.ts`).
- Three FHIR R4 tools: `get_patient`, `search_observations`, `get_medication_list`.
- `axios`-based FHIR client with TLS, configurable base URL (`src/fhir/client.ts`).
- Structured JSON audit logger with SHA-256 patient ID hashing and no-PHI guarantee (`src/audit/logger.ts`).
- Stubs for the production security path: SMART-on-FHIR OAuth 2.1 + PKCE (`src/security/oauth.ts`), SPIFFE Workload API (`src/security/spiffe.ts`), and KMS envelope encryption (`src/security/kms.ts`).
- Zod-validated environment configuration with fail-fast startup (`src/config.ts`).
- Unit tests for the three tools using a stub FHIR client (`tests/tools.test.ts`).
- HIPAA Technical Safeguards compliance mapping with explicit prototype-vs-production gaps (`docs/hipaa-compliance-mapping.md`).
- GitHub Actions CI workflow running typecheck, test, and build.
- Security policy covering scope, private reporting channels, and out-of-scope stubs (`SECURITY.md`).
- README "Why this exists" section explaining the MCP + HIPAA intersection.
- Versioning policy and this changelog.

[0.8.1]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.3.0
[0.1.2]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.0
