# Adding a read-only tool

Checklist for agents and humans. `get_goals` (#73) is the reference: copy its shape and do not invent a new one.

## Rules

- Read only. No FHIR write, no `$everything`, no Bulk Data.
- The zod schema is an allow-list. It keeps codes, statuses, dates and references. It drops `text`, `note`, names, addresses, telecom, identifiers and attachments. A test proves at least one dropped field is absent from the output.
- One tool, one grant: the tool name goes into `TOOL_NAMES`, and calls without a grant fail before any FHIR request.
- Every call goes through `audited()`, which writes exactly one audit record.
- Do not add dependencies. Do not edit any path that `node scripts/risk-tier.mjs --agent` reports as forbidden. That includes `server.json`, `package.json`, `.github/`, `AGENTS.md` and this file.

## Files, in order

| File | Change |
|---|---|
| `src/fhir/schemas.ts` | `<Resource>Schema` and its type |
| `src/fhir/client.ts` | method on the client interface and on the class, using `this.search(...)` |
| `src/fhir/types.ts` | only if a shared type needs a field |
| `src/tools/patient-records.ts` | `export const get<Name> = ... audited(deps, "<tool_name>", ...)` |
| `src/security/patient-policy.ts` | tool name in `TOOL_NAMES` |
| `src/mcp.ts` | import, `toolInputSchemas` entry, `registerTool` with title, description and read-only annotations |
| `src/config.ts` | resource type in `DEFAULT_SMART_SCOPE` |
| `manifest.json` | `tools` entry and the tool count in `description` |
| `tests/patient-records.test.ts` | schema test that drops free text; table row for the client method |
| `tests/patient-policy.test.ts` | grant and denial case |
| `tests/tools.test.ts`, `tests/mcp.test.ts`, `tests/http.test.ts`, `tests/patient-policy.test.ts` | stub for the new client method |
| `tests/stdio.test.ts`, `scripts/demo-package.mjs` | tool count |
| `patient-policy.example.json`, `deploy/demo/patient-policy.json` | tool name in the grant |
| `deploy/medplum-lab/seed.mjs` | one synthetic resource and the tool in the written policy |
| `scripts/smoke-live.mjs` | arguments for the tool |
| `README.md` | row in the tools table |
| `CHANGELOG.md` | line under `Unreleased` / `Added` |

## Done means

```fish
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm check:phi
node scripts/demo-package.mjs
node scripts/risk-tier.mjs origin/main HEAD --agent
```

All pass. Expected tier: T2, because grants and registration change. A human reviews and merges.
