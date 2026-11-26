# Local Medplum lab

A second FHIR server to run `scripts/smoke-live.mjs` against, next to the Epic
sandbox: [Medplum](https://www.medplum.com) in containers, with SMART Backend
Services (`private_key_jwt`). Synthetic data only. It is a test bench, not a
deployment recipe.

Result on 2026-11-26, release 0.8.0 against Medplum 5.2.18: all nine tools
passed with an RS384 key, both with token endpoint discovery and with
`NODE_ENV=production` plus an explicit `SMART_TOKEN_URL`.

## What you need

- Docker with Compose.
- A key pair, and its public JWKS at an HTTPS URL the Medplum container can
  fetch (GitHub Pages works). Medplum reads the JWKS itself; it does not accept
  an uploaded key.

## Run

```fish
cd deploy/medplum-lab
docker compose up -d --wait

# The proxy issues its own certificate. Trust its root for these commands only.
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
set -x NODE_EXTRA_CA_CERTS (pwd)/caddy-root.crt

set -x JWKS_URL https://<your-host>/jwks.json
node seed.mjs
```

`seed.mjs` creates a regular project, a client bound to `JWKS_URL` and one
synthetic patient with one resource per tool. It writes `lab.json` (client id,
patient id, identifier) and `patient-policy.json`.

Then, from the repository root after `pnpm build`:

```fish
set -x FHIR_BASE_URL https://localhost:8443/fhir/R4
set -x SMART_TOKEN_URL https://localhost:8443/oauth2/token
set -x SMART_CLIENT_ID <clientId from lab.json>
set -x SMART_KEY_ID <kid of your key>
set -x SMART_PRIVATE_KEY_FILE /path/to/private-key.pem
set -x PATIENT_POLICY_FILE (pwd)/deploy/medplum-lab/patient-policy.json
set -x LOCAL_SYNTHETIC_PRINCIPAL local-synthetic-operator
set -x AUDIT_HMAC_KEY (openssl rand -hex 32)
set -x SMOKE_PATIENT_ID <patientId from lab.json>
set -x SMOKE_IDENTIFIER 'urn:example:hipaa-fhir-mcp:lab|SYN-0001'
node scripts/smoke-live.mjs
```

Expected last line: `9 tools, 0 failed`.

## Notes

- TLS stays on. The server only talks HTTPS, so Caddy terminates TLS with a
  local authority and Node trusts that root through `NODE_EXTRA_CA_CERTS`.
- Create the client in a regular project. Medplum refuses SMART scopes for
  clients in its super admin project.
- The database password in `compose.yml` is a fixed lab value and no port
  except 8443 is published. Do not reuse this file outside a local test.
- Remove everything with `docker compose down -v`.
