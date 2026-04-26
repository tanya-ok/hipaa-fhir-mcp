# CLAUDE.md

Read by Claude Code at session start. The canonical agent guidance is in [AGENTS.md](./AGENTS.md) - read it first; this file only adds Claude Code specifics.

## Claude Code specifics

- **Iteration**: do not connect Claude Desktop to a live `tsx src/server.ts` while iterating on tool code. Use the MCP Inspector instead: `pnpm dlx @modelcontextprotocol/inspector pnpm exec tsx src/server.ts`. The Inspector reloads tool definitions per call; Desktop caches them per session.
- **HIPAA scope is authoritative**. When proposing changes that touch `src/audit/`, `src/security/`, `src/fhir/client.ts`, or any transport-related code, update `docs/hipaa-compliance-mapping.md` in the same change. Drift between the code and that mapping is the failure mode this prototype is built to avoid.
- **Tests**. The suite uses a stub FHIR client (`tests/tools.test.ts`). Do not add a test that hits the real SMART sandbox - it cycles its data and the tests will flake. If you need new fixtures, add them as inline objects in the stub.
- **Synthetic data only**. The default `FHIR_BASE_URL` points at a public sandbox. Do not paste real patient records, real names, or real identifiers into prompts, tests, or commit messages, even as examples.
- **Audit logger is the boundary**. If you find yourself wanting to write a `console.log` that includes anything patient-shaped, route it through `AuditLogger` instead, and pass the raw id - the logger hashes it.
- **zod is the only validation library** in this repo. Tool inputs, env vars, and FHIR responses all go through a zod schema before the value is used. See "Validation with zod" in `AGENTS.md` for conventions. Do not introduce a second validator (joi, ajv, yup) - use zod or tighten an existing schema.

## What to do when unsure

Prefer to read `README.md` and `docs/hipaa-compliance-mapping.md` together; they cover what is in scope, what is stubbed, and what a real production deployment would replace. If a request would change a stub into a real implementation (OAuth, SPIFFE, KMS), surface that explicitly in the response before writing code - it is a scope change, not a bug fix.
