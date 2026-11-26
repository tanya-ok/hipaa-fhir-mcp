# Data flow

What leaves the FHIR server, where it goes and what is kept. Every statement here describes the code on `main`; the tests that pin the security claims are listed in the README.

## Where data goes

| Destination | What it receives | Kept by this server |
|---|---|---|
| MCP client and its model | The projected fields of the requested resources (table below) | No |
| Audit sink (stderr or `AUDIT_LOG_FILE`) | One record per call: time, tool, HMAC of the patient id, key id, caller label, request id, status, error code, chain id, sequence number, previous record MAC and record MAC | Only in the sink you configure |
| FHIR server | The patient id, search parameters and the backend access token | No |
| SMART token endpoint | A signed client assertion; no patient data | Access token in memory until shortly before expiry |
| Process memory | One response at a time, at most 1 MB and 200 resources per call | No cache, no database, no disk writes besides the audit sink |

## What the model sees

Anything the model sees is PHI when the source is a real record, including ids, dates and codes.

| Resource | Fields returned |
|---|---|
| Patient | id, active, gender, birthDate |
| Observation | id, status, code, subject, effectiveDateTime, issued, valueQuantity, valueCodeableConcept |
| MedicationRequest | id, status, intent, subject, medication code or reference, authoredOn |
| Condition | id, clinical and verification status, code, subject, onset, abatement and recorded dates |
| AllergyIntolerance | id, clinical and verification status, type, category, criticality, code, patient, recordedDate |
| Immunization | id, status, vaccineCode, patient, occurrenceDateTime |
| Encounter | id, status, class, type, subject, period |

Codes keep `system` and `code` only. Names, addresses, identifiers, telecom, notes, narrative, `display` and `text` are dropped before the response leaves the server.

## What is never written

- The plain patient id, in any log or error.
- Response bodies, FHIR server error text and token endpoint responses.
- The search identifier passed to `find_patient`.

## What this does not cover

- The MCP client, the model provider and their retention. Tool results are in their hands once returned.
- The network path. Terminate TLS in front of the HTTP transport.
- The audit sink's storage, retention and access control.
