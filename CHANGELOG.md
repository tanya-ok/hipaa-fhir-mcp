# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the project is pre-1.0, breaking changes may occur in any minor release. See the [Versioning](README.md#versioning) section of the README for the policy.

## [Unreleased]

### Changed

- Dependabot configuration: each ecosystem (npm, GitHub Actions, Docker) now produces at most one routine PR per week, bundling every update-type into a single group. Security advisories still open ad-hoc PRs.
- TypeScript and zod major-version bumps are excluded from automatic Dependabot PRs and must be tackled deliberately. Documented in `.github/dependabot.yml`.

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

[Unreleased]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.0
