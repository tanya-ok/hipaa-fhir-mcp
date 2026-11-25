# Deploying inside your own HIPAA program

This project has not had an independent security review and has never been run against a production EHR. This page lists what a covered entity or business associate must own before pointing it at real records. It is not legal advice and running these steps does not make a deployment compliant.

## Before any real record

| Requirement | Owner | Why |
|---|---|---|
| Business associate agreement with the hosting provider | You | The server processes PHI in memory |
| Business associate agreement with the model provider, with a zero-retention or equivalent term | You | Every tool result is sent to the model |
| Risk analysis that includes this server and the MCP client | You | §164.308(a)(1)(ii)(A) |
| Security review of this code by someone other than its author | You | None has been done |
| EHR client registration with the narrowest system scopes | You and the EHR | The backend credential bounds what can be read |

## Configuration

1. Run the HTTP transport with caller tokens (`MCP_HTTP_TOKENS_FILE`), never demo mode. Terminate TLS in front of it and set `MCP_ALLOWED_HOSTS`.
2. Authenticate to the EHR with SMART Backend Services (`SMART_CLIENT_ID`, `SMART_KEY_ID`, `SMART_PRIVATE_KEY_FILE`). Keep the private key in a secrets manager and mount it read-only, mode 600.
3. Generate `AUDIT_HMAC_KEY` with `openssl rand -hex 32`, store it in a secrets manager and inject it at start. Do not reuse a demo key.
4. Write the patient policy with one grant per principal, listing only the patients and tools that principal needs. Keep the file under change control.
5. Set `NODE_ENV=production`. Production refuses the demo HMAC key and a missing `FHIR_BASE_URL`.
6. Run the published image by digest and verify its signature.

## Audit log

- Collect stderr or `AUDIT_LOG_FILE` into append-only storage with the retention your policy requires (HIPAA requires six years for documentation under §164.316(b)(2); many programs apply the same period to audit logs).
- Restrict read access; the log shows who read which hashed patient and when.
- Alert on `status=error` with `patient_not_authorized`.

## Network

- Allow egress only to the FHIR base and the token endpoint.
- Allow ingress only from the MCP clients you operate.

## What stays open after all of this

- No human identity or consent check: a principal is a workload.
- No emergency access procedure.
- The model and client hold the tool results; this server cannot control their retention.
