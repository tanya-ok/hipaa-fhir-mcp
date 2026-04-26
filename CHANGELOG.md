# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the project is pre-1.0, breaking changes may occur in any minor release. See the [Versioning](README.md#versioning) section of the README for the policy.

## [Unreleased]

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

[Unreleased]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.3.0
[0.1.2]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.0
