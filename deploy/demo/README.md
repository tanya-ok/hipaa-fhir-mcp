# Public demo deployment

Live at `https://hipaa-fhir-mcp-demo.fly.dev/mcp` (Fly.io, Amsterdam, `fly.toml` in this folder).

A hosted endpoint anyone can try without installing anything. It can only ever
reach the public synthetic SMART sandbox: `MCP_DEMO=1` refuses to start with any
other `FHIR_BASE_URL` or with backend credentials, and the policy grants only
five synthetic patients.

## Build

```sh
docker build --build-arg VERSION=0.7.0 -t hipaa-fhir-mcp-demo deploy/demo
```

## Run anywhere that runs a container

| Setting | Value |
|---|---|
| Port | 8080 |
| Health check | `GET /healthz` |
| Secret | `AUDIT_HMAC_KEY`: 64 hex characters (`openssl rand -hex 32`), set as a platform secret |
| `MCP_ALLOWED_HOSTS` | the public hostname, for example `demo.example.org` |

TLS is terminated by the platform. Point an MCP client at `https://<host>/mcp`.

## Synthetic patients in the demo

The ids in [`patient-policy.json`](patient-policy.json) are synthetic Synthea
patients on `r4.smarthealthit.org`. Try `get_patient_summary` with
`1ac8947d-038f-4cc7-81fa-a32e694187e8`.
