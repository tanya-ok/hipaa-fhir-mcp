# Security policy

## Scope

This repository is a **prototype**. It targets a public synthetic FHIR sandbox at `https://r4.smarthealthit.org` and **never touches PHI**. It is not deployed and does not process production traffic.

The full compliance posture, including explicit gaps between the prototype and a production-ready system, is documented in [`docs/hipaa-compliance-mapping.md`](docs/hipaa-compliance-mapping.md). Treating the prototype as production-ready would itself be non-compliant.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-related findings.

Use one of the following private channels:

- **Preferred**: GitHub private vulnerability reporting on this repository (Security tab → "Report a vulnerability").
- **Alternative**: contact the maintainer ([@tanya-ok](https://github.com/tanya-ok)) via the email listed on the GitHub profile.

When reporting, please include:

- Affected file(s) and line numbers, or a minimal code snippet.
- A short reproduction or proof-of-concept where applicable.
- An impact assessment (what an attacker could achieve).
- Any suggested remediation.

## Response

| Stage | Target |
|---|---|
| Acknowledgement of report | within 5 business days |
| Initial triage and severity assessment | within 10 business days |
| Coordinated disclosure timeline | case by case |

Reporters acting in good faith will be credited in the release notes for the fix unless they request otherwise.

## Out of scope

The following items are documented as **stubs** or known gaps in this repository. They are part of the production upgrade path in [`docs/hipaa-compliance-mapping.md`](docs/hipaa-compliance-mapping.md) and are not vulnerabilities:

- `src/security/oauth.ts` - SMART-on-FHIR OAuth 2.1 + PKCE flow (stub).
- `src/security/spiffe.ts` - SPIFFE Workload API client (stub).
- `src/security/kms.ts` - KMS envelope encryption (stub; no cache exists yet).
- Fine-grained SMART scope enforcement.
- VPC endpoint, security group, and CDK infrastructure (belongs in a separate stack alongside the service).
- Log integrity (CloudWatch object-lock-equivalent via S3 export).

Findings that report these as bugs will be closed as expected behaviour.

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes |
| Tagged releases | Latest only |

The repository is pre-1.0 and history may be restructured. Pin to a specific commit SHA for reproducibility.

## Out-of-band signal

If you find evidence of PHI in any commit, log line, test fixture, or audit artifact in this repository, treat it as a critical finding and follow the private reporting steps above before opening any public discussion.
