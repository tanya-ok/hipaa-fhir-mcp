# HIPAA compliance mapping

This document maps each control implemented in the prototype to a specific HIPAA Security Rule safeguard. It is scoped to the **Technical Safeguards** in 45 CFR §164.312. Administrative and Physical safeguards are out of scope for this code - they are organizational controls (training, workforce clearance, facility access) and are not the job of this MCP server.

For every row we distinguish two states:
- **Prototype**: what the code in this repository does today.
- **Production**: what must be added before the server may process real PHI under a Business Associate Agreement.

## §164.312(a) - Access Control

| Control | Standard | Prototype | Production |
|---|---|---|---|
| Unique user identification | §164.312(a)(2)(i) | `CALLER_IDENTITY` env var is stamped on every audit record. | Replaced by SPIFFE SVID (`spiffe://.../hipaa-fhir-mcp`) fetched from the Workload API. Upstream human identity carried in the SMART access token claims. See `src/security/spiffe.ts`. |
| Emergency access procedure | §164.312(a)(2)(ii) | Not implemented - prototype is read-only against a sandbox. | Documented break-glass role with mandatory audit review and time-bound STS credentials; CMK key policy grants temporary `kms:Decrypt` with `Condition.DateLessThan`. |
| Automatic logoff | §164.312(a)(2)(iii) | Process is short-lived per MCP stdio session. | SMART access tokens are minted with short TTL; session invalidation propagates via token revocation at the FHIR AS. |
| Encryption and decryption | §164.312(a)(2)(iv) | TLS in transit for all FHIR calls; no at-rest cache. | KMS envelope encryption for any cached response - `src/security/kms.ts`. Plaintext data keys zeroed after use. |

## §164.312(b) - Audit Controls

| Control | Standard | Prototype | Production |
|---|---|---|---|
| Record and examine activity | §164.312(b) | Structured JSON audit record for every tool invocation: `timestamp, tool, patient_id_hmac, caller_identity, request_id, status, error_code`. PHI is excluded. `patient_id` is HMAC-SHA-256 hashed with a server-side secret (`AUDIT_HMAC_KEY`) before logging; plain SHA-256 would be reversible by enumeration if the id space were small or predictable, so the keyed HMAC is used instead. The hash is deterministic by design so audit lines and KMS decrypt logs cross-reference the same patient. Writes to stdout (production) or a local file (dev). | Stdout is collected by the container runtime into CloudWatch Logs with an infrequent-access retention policy and a 2-year retention floor. The HMAC key is sourced from a secrets manager (Secrets Manager / Vault / KMS-derived) at process start, never logged. A metric filter on `status=error` feeds an alarm. CloudTrail captures KMS Decrypt and HealthLake DataAccess events to cross-reference against the application audit trail. |

## §164.312(c) - Integrity

| Control | Standard | Prototype | Production |
|---|---|---|---|
| Mechanism to authenticate ePHI | §164.312(c)(2) | FHIR responses are validated for `resourceType`; TLS protects in-transit integrity. | HealthLake versions every resource; the client records `meta.versionId` in the audit trail to detect out-of-order reads. If any cache is introduced, the ciphertext carries an HMAC-equivalent GCM auth tag. |

## §164.312(d) - Person or Entity Authentication

| Control | Standard | Prototype | Production |
|---|---|---|---|
| Verify identity before granting access | §164.312(d) | Sandbox is unauthenticated. Caller identity placeholder is static. | SMART-on-FHIR OAuth 2.1 + PKCE flow - `src/security/oauth.ts`. Workload-to-workload authentication is mTLS with SPIFFE SVIDs. The MCP server refuses requests whose peer SVID is not on the allowlist. |

## §164.312(e) - Transmission Security

| Control | Standard | Prototype | Production |
|---|---|---|---|
| Integrity controls during transmission | §164.312(e)(2)(i) | `axios` uses Node's TLS with system trust store; `NODE_TLS_REJECT_UNAUTHORIZED` is never set to `0`. | mTLS between the MCP server and the FHIR endpoint (HealthLake via VPC interface endpoint). Egress security group restricts traffic to the VPC endpoint ENI only. |
| Encryption during transmission | §164.312(e)(2)(ii) | TLS 1.2+ via Node defaults. Bearer tokens, when present, are sent over TLS only. | TLS 1.3 where supported. VPC endpoint policy restricts `healthlake:*` calls to the specific datastore. No public-internet path exists. |

## Controls outside the Security Rule but commonly required

| Control | Source | Prototype | Production |
|---|---|---|---|
| Business Associate Agreement | §164.308(b) | N/A - prototype uses a public sandbox, no PHI. | BAA with AWS covers HealthLake, KMS, CloudWatch. BAA with any downstream LLM provider is required before passing PHI outside the workload. |
| Minimum necessary | §164.502(b) | Tool inputs are scoped to `patient_id` and a single `code`. No bulk or open-ended search. | SMART scopes narrowed to `patient/*.rs` with context binding; the MCP server rejects scopes broader than it needs. |
| Breach notification readiness | §164.400-414 | Audit records contain enough context to scope a breach (who, when, what hash). | CloudWatch alarm on anomalous access patterns; incident response runbook references the audit stream. |

## Gaps - explicit

The prototype deliberately does **not** implement the following. They are called out so a reader does not mistake the scaffold for a finished system:

- Real OAuth 2.1 + PKCE flow (stub only in `src/security/oauth.ts`).
- Real SPIFFE Workload API client (stub only in `src/security/spiffe.ts`).
- KMS envelope encryption (stub only in `src/security/kms.ts`); no cache exists yet.
- Fine-grained SMART scope enforcement.
- HealthLake driver; prototype only targets the public SMART sandbox.
- VPC endpoint + security group configuration (infrastructure concern - belongs in a CDK stack alongside this service).
- Log integrity (CloudWatch Logs Insights with object-lock equivalent on an S3 export).

A deployment that treats this prototype as production-ready would be non-compliant. The gaps list above is the upgrade path.
