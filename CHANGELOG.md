# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the project is pre-1.0, breaking changes may occur in any minor release. See the [Versioning](README.md#versioning) section of the README for the policy.

## [Unreleased]

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

[Unreleased]: https://github.com/tanya-ok/hipaa-fhir-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tanya-ok/hipaa-fhir-mcp/releases/tag/v0.1.0
