# Development plan for hipaa-fhir-mcp

Updated on 2026-10-06. Keep this as a synthetic healthcare prototype with explicit production gaps. The shared Kubernetes gateway now integrates real SPIRE mTLS, resource-bound OAuth and verified request-local caller context; this does not complete the standalone HTTP client or clinical authorization work.

## Current integration and next boundaries

Local commit `533f8ea` added the reusable MCP factory, safe stderr audit and shared synthetic gateway. The local gate was freshly rerun on 2026-10-06: ten tests, typecheck, build, Biome and the PHI sweep passed. The shared eighteen-scenario integration and teardown were also freshly rerun that day, including three permitted tools, denied callers, input rejection and audit data minimization. See [shared Kubernetes integration](kubernetes-lab.md).

Audit no longer shares MCP stdout, fixed tool errors no longer return an upstream path, and concurrent HTTP callers cannot overwrite each other's identity. Known-tool schema rejection is audited by the HTTP gateway. Resolved: standalone stdio now audits schema rejections and unknown-tool calls before SDK dispatch with fixed labels (`91aa759`).

Runtime validation of the real HTTP client's FHIR resources, a minimal field projection and bounded pagination are implemented (`91aa759`), and the server metadata uses the package version. The next domain work is explicit authorization of the requested records before dispatch.

A human identity provider can supply a verified user and roles for the optional demo. It does not implement SMART-on-FHIR, clinical consent, KMS or a clinical access policy. Preserve the separation between the user's authority, the acting workload identity and the backend's own credential; never forward the incoming MCP token upstream. The [shared development plan](https://github.com/tanya-ok/mcp-svid-auth/blob/main/docs/portfolio-development-plan.md) defines that staged integration.

## Historical review on 2026-10-04

The following snapshot was recorded against local commit `b7adee7`, before the shared gateway. Its stdout, error-path, HTTP response-validation and standalone stdio rejection findings all describe repaired behavior.

## Confirmed findings

Typecheck, 8 existing tests, build, Biome, and the PHI shape sweep passed. Those tests exercise tool functions with a stub client, rather than the complete MCP and HTTP boundaries.

A local probe started the built stdio server and supplied synthetic responses through a mocked Axios adapter, with no external requests. It observed:

| Request | Observed result |
|---|---|
| `get_patient` with an `Observation` response | Successful tool result containing `Observation`, plus one audit JSON line in the MCP stdout channel |
| `get_patient` with an upstream 404 | Error result containing the synthetic patient id in the request path, plus one audit JSON line in stdout |
| `get_patient` with invalid id syntax | Error result and zero audit records |

These are reproducible boundary defects, not evidence of real PHI exposure. The [MCP stdio specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio) reserves stdout for protocol messages. At that commit, `AuditLogger` used stdout in production and as a fallback when a development file sink failed. Resolved: audit now goes to stderr, or to an explicitly configured file with stderr fallback, and never to stdout.

## First milestone

| Priority | Proposed work | Acceptance criterion |
|---|---|---|
| P0 | Separate audit output from protocol stdout | Success, upstream failure, production mode, and file sink failure leave stdout containing only valid JSON-RPC; audit uses stderr or a dedicated sink |
| P0 | Validate FHIR responses at runtime | Wrong resource types, malformed bundles, and invalid entries produce fixed safe errors; only explicitly projected fields reach the tool result |
| P0 | Audit accepted and rejected requests at one boundary | Exactly one record per invocation, including schema denial and unknown-tool attempts; no raw invalid input, response body, or patient identifier reaches logs |
| P1 | Repair clean environment startup instructions | Explicitly load `.env` for the development command, supply the HMAC key in manual Desktop setup, and verify Inspector and extension paths separately |
| P1 | Sanitize errors and validate network destinations | Client errors contain stable codes rather than paths or exception text; HTTPS is required except for an explicit local synthetic test mode; redirects cannot carry credentials to an unapproved origin |
| P1 | Align implementation and claims | Remove the ambiguous production-grade wording, update stale SHA-256 descriptions in AGENTS.md to HMAC, use the package version in server metadata, and correct the stdout diagram |

Expected effort: about one focused week for the protocol and audit repairs, with response projection following as a separate change. Write regression tests around the real stdio transport and mocked upstream boundary, not only around tool functions.

## Second milestone

Choose one clinical authorization mode. [SMART App Launch 2.2](https://hl7.org/fhir/smart-app-launch/) supports interactive authorization and a distinct [Backend Services profile](https://hl7.org/fhir/smart-app-launch/backend-services.html). For an unattended synthetic agent demo, begin with Backend Services and resource-specific read/search scopes. For an interactive clinician workflow, use the launch context and authorization code flow with PKCE. Do not treat PKCE as the authentication mechanism for the unattended case.

Add explicit patient and operation authorization before a FHIR request. A workload SPIFFE ID establishes which software is calling; it does not establish the patient's consent or the caller's clinical authority. Test a permitted request, a different patient's request, insufficient scopes, expiration, and denied discovery endpoints. Keep MCP credentials separate from the upstream FHIR credential.

Use bounded results, explicit continuation, resource-specific output schemas, and a minimal field projection. Filter active medications if that remains the tool's documented behavior. Treat narrative and free text as untrusted data. Prefer the existing read-only tool surface while proving these controls.

## Demo and production limits

The existing Claude Desktop walkthrough is useful, but a copied `.env` is not loaded by `tsx` automatically and the manual Desktop example omits the required HMAC key. Add an offline synthetic demo with fixed fixtures, audit assertions, and safe error cases; make the rotating public sandbox optional.

Defer KMS envelope encryption until persistent payload storage has a defined need and lifecycle. Keep SMART, SPIFFE, and KMS gaps explicit until they are implemented and validated. HMAC correlation is pseudonymization, not a compliance certificate. The [FHIR security guidance](https://hl7.org/fhir/R4/security.html) treats authentication, authorization, audit, and deployment policies as surrounding system responsibilities.

Completion requires typecheck, tests, build, Biome, PHI sweep, and an actual stdio session. Real PHI, production deployment, BAA review, and remote client compatibility were not validated in this review.

## Roadmap after the 2026-11-01 review

Ranked by security value per effort after a cross-model review. Every denial test needs a matching allowed case.

| Order | Work | Acceptance criterion |
|---|---|---|
| 1 | Per-patient authorization before FHIR dispatch | The allowed patient comes from a verified caller context (the optional human identity provider demo or a validated access token), never from a tool argument alone. All three tools refuse a different patient before any FHIR request; searches, `subject` and `patient` parameters and returned resources outside the granted patient are refused or filtered; each refusal is audited once with a fixed safe error; the same caller reading the granted patient succeeds |
| 2 | Trusted identity boundary | Document and test which component establishes caller identity and the patient grant in each mode (stdio demo, HTTP gateway, shared lab). A missing or unverifiable context denies by default |
| 3 | SMART Backend Services client authentication | Asymmetric client authentication per [SMART App Launch 2.2 Backend Services](https://hl7.org/fhir/smart-app-launch/STU2.2/backend-services.html) against a lab-local synthetic SMART server. A JWT-SVID assertion ([draft-ietf-oauth-spiffe-client-auth](https://datatracker.ietf.org/doc/draft-ietf-oauth-spiffe-client-auth/)) is used only where the server explicitly supports that profile |
| 4 | Key lifecycle | HMAC key rotation and JWKS refresh behaviour are specified and tested before any production claim |

## Task tracking checkpoint

The [2026-10-07 portfolio checkpoint](https://github.com/tanya-ok/mcp-svid-auth/blob/main/docs/portfolio-checkpoint-2026-10-07.md) reconciles this plan with local beads tasks. Use `bd --sandbox ready` before starting work and update task status and validation evidence as work progresses. Public task snapshots are in `.beads/issues.jsonl`; local databases stay untracked. Remote synchronization is disabled.
