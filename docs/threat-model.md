# Threat model

Scope: the server process, its two transports, the patient policy, the audit log and the backend credential. Out of scope: the MCP client, the model, the FHIR server and the host.

## Assets

| Asset | Why it matters |
|---|---|
| Patient records on the FHIR server | The data being protected |
| Backend credential (SMART private key or static token) | Reads every patient the EHR allows the client |
| `AUDIT_HMAC_KEY` | Links audit records to patients |
| Patient policy file | Decides who may read whom |
| Caller tokens (HTTP transport) | Establish the principal |

## Trust boundaries

1. Model and MCP client to server: tool arguments are untrusted.
2. Server to FHIR server: responses are untrusted.
3. Operator to server: environment, policy file and key files are trusted.

## Threats and controls

| Threat | Control | Residual risk |
|---|---|---|
| A prompt-injected model asks for another patient | Deny-by-default grant on principal, patient and tool, with an optional expiry, checked before any FHIR request | A model can still read every patient its principal is granted |
| The model supplies an identity or grant in arguments | Identity comes only from the transport; such arguments are ignored | None known |
| Free text in a record carries instructions to the model | Narrative, notes, `display` and `text` are dropped; codes and dates remain | A crafted code or id string is still passed through, bounded in length |
| A hostile or broken FHIR server returns another patient's data | Each resource's subject is checked against the requested patient; mismatches fail the call | Trust in the FHIR server's own access control remains |
| A pagination link points to another host | Continuation links must stay on the FHIR base origin and path; the credential is never sent elsewhere | None known |
| Oversized or endless responses | 1 MB response cap, 200 results, 5 pages, request timeout | A slow server can hold one request until the timeout |
| Patient ids leak through logs or errors | HMAC of the id in audit records; fixed error texts; no response bodies logged | The model and client see ids by design |
| Backend credential leaks | Key file must be mode 600; tokens are kept in memory and never logged or returned; in production the signed client assertion goes only to the configured `SMART_TOKEN_URL` | Host compromise exposes the key |
| Caller token theft (HTTP) | Tokens are compared in constant time and stored hashed in a mode 600 file; rate limit per client address | No token expiry or revocation list; rotate the file |
| Audit record tampering | Each record carries an HMAC and links to the one before it; `scripts/verify-audit.mjs` reports an edited, removed or repeated record, and `--strict` also fails on records it cannot verify | Records cut from the end of a chain and a whole removed chain are not detected; a key holder can re-sign a log. Use append-only storage |
| Abuse of the public demo | Demo mode only starts against the public synthetic sandbox with no backend credential | Synthetic data is public by design |

## Not addressed

- Human authentication and consent. A principal is a workload or an operator label.
- Emergency access.
- Availability beyond a per-client rate limit.
- Independent security review. None has been done.
