# Shared Kubernetes integration

The local lab in the sibling `mcp-svid-auth` repository runs Kubernetes and
containerd in a dedicated Lima VM. It loads this server and `mcp-spiffe-bridge`
into one FHIR service, with real SPIRE workload credentials. `ecs-contract` is
excluded. The platform tools are CNCF-hosted projects.

From the sibling `mcp-svid-auth` directory, run `make up` to launch the services or
`make demo` for a fresh eighteen-scenario integration check. Use `make down` and
`make runtime-stop` afterwards only if no sibling project needs the shared VM.
Keep it running while CISO Assistance uses it. The VM is bounded to 2 CPUs and
4 GiB guest memory.
No service is published externally and no registry or GitHub push is required.

## Authentication and FHIR scope

`deploy/kubernetes/fhir-gateway.mjs` authenticates each TLS peer through the
bridge, using its own X.509-SVID and the real SPIRE trust bundle. The service's
certificate contains `fhir.security-lab.svc.cluster.local`, and normal hostname
verification stays enabled. Research workloads must also provide an ES256
`at+jwt` access token from `mcp-svid-auth` bound to this FHIR resource. The token
subject must equal the verified mTLS SPIFFE ID and carry `fhir:read`.

Before starting TLS, the gateway discovers the registered tools through the official SDK over an in-memory transport. Missing or duplicate scope declarations stop startup.

The gateway uses `createFhirMcpServer` from `src/mcp.ts` with a trusted caller
provider backed by the bridge's async request context. Each invocation receives
its own dependency configuration; concurrent callers cannot change a shared
`CALLER_IDENTITY`. Client headers cannot supply caller identity. The existing
three FHIR tools and their Zod input schemas are reused by both stdio and HTTP.

The FHIR adapter in this gateway is explicitly an offline synthetic fixture. It
returns a minimal Patient, Observation and MedicationRequest. It does not use
the public sandbox, HealthLake or real PHI. The SMART, KMS and standalone SPIFFE
modules remain documented stubs. The gateway does not replace a production FHIR
client or provide human authorization.

`deploy/kubernetes/fhir-gateway.mjs` is not standalone. It imports
`./token-verifier.mjs` from the sibling `mcp-svid-auth` lab and expects that
lab's image layout (`/bridge`, `/fhir`). Run it only through that lab.

The lab's authorization verifier resides in
`mcp-svid-auth/deploy/kubernetes/token-verifier.mjs`. Its crypto tests reject
wrong/multiple audiences, another peer, wrong issuer, expired/future/missing
claims, altered headers, forged signatures, ambiguous keys and missing scope.
The gateway fetches public JWKS only from the fixed local issuer and forwards no
incoming token upstream. It rechecks token/peer expiry before FHIR dispatch.

## Audit and failure behavior

The tool audit records the authenticated caller and HMAC-SHA-256 patient ID,
never the plaintext ID or clinical content. The HMAC key is generated at process
startup and not committed. It changes on restart, so durable cross-restart
correlation is deliberately not implemented by this lab.

Audit uses stderr rather than the stdio MCP response channel. File-sink failure
uses stderr and a fixed diagnostic without the path or exception text. Tool
errors and process failures return fixed messages. Zod rejects inputs before
tool dispatch; the HTTP boundary emits exactly one `invalid_arguments` audit for
a known tool's rejected arguments, the same label standalone stdio uses.
Malformed/unknown protocol requests are denied without becoming tool
invocations. Standalone stdio audits its own pre-handler rejections.

`deploy/kubernetes/probe_fhir.py` is the shared lab's test adapter. It uses the
root project's Python MCP client and real Workload API. Its TLS private key files
are temporary, mode 0600, and removed after the probe. It prints only safe
outcomes. It checks the three tools, audience/missing bearer/input denials,
disallowed/absent certificates and exactly four invocation audit records without
patient identifiers. The audit checker remains here with the FHIR domain schema.

The absent-certificate check uses the shared
`mcp-svid-auth/deploy/probe_mtls.py` helper, copied into the Python probe image.
It connects to an address already checked by the URL policy, retains trust and
hostname verification, and reads an explicit TLS peer-authentication alert.
The 2026-10-06 repeat exposed a case where the HTTP client reported only a
connection reset. A reset, timeout, server-certificate failure, silent close or
HTTP response is not counted as proof of certificate rejection. Twelve offline
cases in the coordinator cover that distinction. An additional host-side
regression proves the audit command loads without the container-only TLS helper.
All eighteen shared scenarios passed after a fresh rebuild on 2026-10-06 at
14:55 UTC and again with the main passwordless profile enabled at 15:02 UTC,
including absent-certificate rejection and exactly four safe invocation audit
records. After host disk exhaustion and an operator-approved VM restart, a
fresh eighteen-scenario recovery cycle passed between 15:25 and 15:31 UTC,
including final scoped teardown preserving CISO's namespace and the VM. This
changes test evidence, not gateway authorization or clinical data handling.

The bridge checks credential availability on every request. The gateway exits
after credential-stream loss, allowing Kubernetes to replace the process. It
never serves with an expired cached SVID and does not disable TLS verification.

This is not HIPAA-certified software. Production still requires a real backend,
SMART authorization, human identity, managed HMAC keys, durable independent audit
retention, access reviews and organizational safeguards.

## Runtime convention

The stdio server and Desktop bundle remain host applications. Containerized
integration uses Lima, Kubernetes and containerd, with Buildah for OCI image
builds. No Docker or Podman daemon is required. The shared lab owns lifecycle and
scoped teardown. `Dockerfile`, `docker.io` image locations and Dependabot's
`docker` ecosystem describe OCI image builds and dependency updates; they do not
require the Docker runtime.
