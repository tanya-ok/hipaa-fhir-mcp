# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Copilot, Aider, etc.) working on this repository. Humans should also read this; it is the shortest path to a coherent change.

## What this repo is

`hipaa-fhir-mcp` is a portfolio / open-source prototype of a HIPAA-oriented MCP server that exposes FHIR R4 tools to AI agents over stdio.

It is a **prototype**, not a production system. The "HIPAA scope statement" table in `README.md` is the source of truth for what is in and out of scope. Read it before proposing changes that touch security, transport, or data flow.

## Stack

| | |
|---|---|
| Language | TypeScript (strict), ESM, Node.js 25+ |
| MCP | `@modelcontextprotocol/sdk` over stdio |
| HTTP | `axios` (TLS 1.2+ enforced) |
| Validation | `zod` |
| Test | `vitest` |
| Build | `tsc` to `dist/` |

Package manager: `npm` (lockfile committed). Do not migrate to pnpm or yarn without an explicit ask.

## Commands

```fish
npm install
npm run dev         # tsx src/server.ts
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc -> dist/
npm start           # node dist/server.js (after build)
```

To exercise the server interactively:

```fish
npx @modelcontextprotocol/inspector npx tsx src/server.ts
```

## Layout

| Path | Purpose |
|---|---|
| `src/server.ts` | MCP server entry, stdio transport, tool registration |
| `src/config.ts` | zod-validated env, fails fast on missing values |
| `src/audit/logger.ts` | Structured audit log, SHA-256 patient id hashing |
| `src/fhir/client.ts` | HTTP FHIR client (axios), swappable for HealthLake |
| `src/fhir/types.ts` | Minimal FHIR R4 types used by the tools |
| `src/tools/*.ts` | The three exposed MCP tools and their zod input schemas |
| `src/security/oauth.ts` | SMART-on-FHIR OAuth 2.1 + PKCE stub |
| `src/security/spiffe.ts` | SPIFFE Workload API stub |
| `src/security/kms.ts` | KMS envelope encryption stub |
| `tests/tools.test.ts` | Unit tests against a stub FHIR client |
| `docs/hipaa-compliance-mapping.md` | Control-by-control HIPAA mapping |

## Hard rules

These rules are non-negotiable. Do not relax them, even temporarily, even in tests.

1. **No PHI in logs.** `patient_id` is only ever written as a SHA-256 hash. No name, DOB, address, or free-text clinical content goes to stdout, the audit log, or any other sink. If you add a log line that includes a patient identifier or response body, you are introducing a HIPAA §164.312(b) violation.
2. **Never disable TLS verification.** No `NODE_TLS_REJECT_UNAUTHORIZED=0`, no axios `httpsAgent: { rejectUnauthorized: false }`. Fix the certificate, not the check.
3. **Every tool invocation emits exactly one audit record**, including failures. The audit logger is the boundary; do not bypass it for "small" tools.
4. **Synthetic data only.** The default `FHIR_BASE_URL` is the public SMART sandbox at `https://r4.smarthealthit.org`. Do not commit fixtures, tests, or examples that point at real PHI.
5. **Production posture is documented as gaps, not faked.** `oauth.ts`, `spiffe.ts`, and `kms.ts` are deliberate stubs. Do not replace them with mock-success implementations that look real - someone reading this as a HIPAA reference would be misled. If you implement one for real, update the gap row in `docs/hipaa-compliance-mapping.md` in the same PR.
6. **No new dependencies without justification.** Each new dependency is a supply-chain surface. Prefer the standard library or an existing dependency.

## Validation with zod

`zod` is the only input-validation library in this repo. Use it at every boundary where untrusted or external data enters the program. Specifically:

- **Tool inputs** from MCP callers: each tool in `src/tools/*.ts` exports its `Input` schema (e.g. `GetPatientInput`); `server.ts` passes `Schema.shape` to `registerTool` so the SDK validates before calling the handler. Do not bypass this.
- **Environment variables**: `src/config.ts` parses `process.env` through a zod schema and fails fast on startup. Add new env vars there, never read `process.env` directly from feature code.
- **FHIR responses**: parse responses from `HttpFhirClient` against the FHIR types in `src/fhir/types.ts` before handing them to a tool. The sandbox is helpful but not always conformant; treat its responses as untrusted.

Conventions:

- Put schemas next to the code that uses them, not in a global `schemas/` directory.
- Name them `<Thing>Input`, `<Thing>Schema`, or `<Thing>Output`. Export the inferred type with `type Foo = z.infer<typeof FooSchema>`.
- Use `.parse()` for the fail-fast path. Use `.safeParse()` only when you need to map a validation failure to a structured response (e.g. an MCP error result). Do not use `.passthrough()` or `.catchall()` to silence schema gaps - tighten the schema.
- Never paste a FHIR response into a string-templated log line. If you need to surface a field, parse it first and log only the parsed fields you allow.

## Adding a new tool

1. Create `src/tools/<name>.ts`. Export a zod input schema (`<Name>Input`) and an async function that takes `(input, deps: ToolDeps)`.
2. Validate input with zod via the SDK's `inputSchema: <Name>Input.shape` registration. Do not trust caller input.
3. Call `audit.record(...)` exactly once per invocation, including the failure path. Pass the raw `patient_id`; the logger hashes it.
4. Register the tool in `src/server.ts` with a `description` that names the FHIR resource and warns about PHI in the response.
5. Add a unit test in `tests/tools.test.ts` using the existing stub FHIR client. Do not call the real sandbox in tests.
6. Update the tools table in `README.md`.

## Conventions

- All committed artifacts (code, comments, commit messages, PR descriptions, docs) are in **English**.
- Never use em dashes (U+2014) or en dashes (U+2013). Use a hyphen, comma, period, or new bullet.
- Commits: `type(scope): Subject` where `type` is one of `feat fix docs ci chore refactor test sec perf`. Subject capitalized, no trailing period, ~50-72 chars.
- Branches: `feat/...`, `fix/...`, `docs/...`, `chore/...`. Never push directly to `main` - PR only.
- Default to no comments. Add a comment only when the *why* is non-obvious (a hidden constraint, a workaround, a security invariant).
- Do not add features beyond the task. Do not "improve" surrounding code in a bug-fix PR.

## Definition of done

A change is done when all of the following hold:

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` produces `dist/` cleanly.
- Any new tool registers itself, validates input with zod, and emits an audit record on every invocation including failure.
- The HIPAA scope table in `README.md` and the control table in `docs/hipaa-compliance-mapping.md` remain accurate.
- The change is in a feature branch with a passing CI run, and the PR description states the HIPAA impact (or "none, internal refactor").
