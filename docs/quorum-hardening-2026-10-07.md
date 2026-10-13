# Quorum hardening - 2026-10-07

The implementation resolves the bounded portfolio tasks fhir-tfz, fhir-rhq and
fhir-lx6. Synthetic tests cover the HTTP and actual stdio boundaries. A separate
production-configuration peer review is recorded by the portfolio coordinator;
model votes are independent of these executed tests.

## Decisions

- Production requires an explicitly selected HTTPS FHIR base URL. Embedded URL
  credentials, query strings and fragments are refused in every environment.
  An omitted NODE_ENV also requires an explicit URL. Only explicitly selected
  development/test without a backend token may use the synthetic SMART default.
  A configured token always requires an explicit destination.
- A static backend token and a development audit file are optional. Stdio still
  has an operator-supplied identity label; production mode does not authenticate
  that label or implement SMART. Production audit uses stderr.
- Runtime Zod schemas project a documented, small resource subset. They check the
  requested record identity, search resource type, required fields and subject
  reference. Unknown fields are stripped recursively. This does not prove clinical
  consent or full FHIR conformance.
- Search consumes server continuation links within its configured HTTPS origin
  and base path. Five pages, 200 results and 1 MiB decoded content per response
  are hard limits; exceeding them fails the whole call without partial success.
  Cycles, ambiguous links, repeated records and mixed subjects are refused.
  Redirects are disabled and TLS verification stays enabled, TLS 1.2 minimum.
- Stdio validates tool calls before SDK dispatch. Rejected calls get one audit
  record with fixed tool/error labels and a sentinel HMAC, never invalid input.
  Accepted calls retain the single existing handler audit. The separate HTTP
  gateway keeps its own rejection boundary.
- Development startup loads .env explicitly, server metadata uses package.json,
  and extension documentation correctly describes stderr and identity labels.

## Validation

51 tests passed, including a real child process using the SDK stdio client and
an injected Axios adapter. The stdio test covers successful, malformed-input,
unknown-tool, upstream-error and wrong-resource calls, then a successful call
again; seven invocations produce seven safe audit records and no protocol errors.
HTTP tests cover projection, wrong type/identity, malformed search results,
cross-origin/downgrade/escaping continuation, cycles, page/result limits and
inactive-medication filtering. All HTTP responses are synthetic; no sandbox,
clinical system or PHI was used.

Typecheck, build, Biome and the PHI shape sweep passed. The first stdio run under
heavy host load exceeded Vitest's five-second default; the test now has a bounded
30-second startup allowance and passed again. Remote CI, native Desktop extension
compatibility and a real clinical deployment remain separate validation gates.

## Follow-up review

Focused configuration run 20261007T152309485403Z completed Claude research, then
Codex verification was refused by the existing privacy filter. The run is
incomplete, with no consensus or Kimi vote. Claude identified implicit development
mode combined with a backend token and a default endpoint. Three additional tests
cover omitted mode, implicit destination with a token, and explicit HTTPS without
a mode. The implementation now refuses the first two cases. No PHI egress was
executed or demonstrated. The preceding broad follow-up timed out; source files
excluded by the privacy filter were never sent in the subsequent targeted run.
