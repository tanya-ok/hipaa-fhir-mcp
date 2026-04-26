# Security automation

This document explains the security automation that runs on this repository, with a focus on the bespoke PHI sweep that supports the no-PHI claim made in `README.md` and `SECURITY.md`.

## Overview

| Check | What it does | Where it lives |
|---|---|---|
| Typecheck / test / build | Catches broken code on every push and PR. | `.github/workflows/ci.yml` |
| `pnpm audit --audit-level moderate` | Fails the build on `moderate` or higher dependency vulnerabilities. | `.github/workflows/ci.yml` |
| PHI sweep | See below. | `scripts/check-phi.mjs`, run from `.github/workflows/ci.yml` |
| CodeQL | GitHub-native static analysis for JavaScript/TypeScript with the `security-extended` query pack. Runs on push, PR, and weekly on a schedule. | `.github/workflows/codeql.yml` |
| gitleaks | Scans the full git history for secret-shaped strings on every push and PR. | `.github/workflows/gitleaks.yml` |
| Dependabot | Weekly grouped PRs for the pnpm, GitHub Actions, and Docker ecosystems. Security alerts open ad-hoc PRs as soon as advisories land. | `.github/dependabot.yml` |

## PHI sweep (`scripts/check-phi.mjs`)

The repository's central claim is that no Protected Health Information is ever processed, committed, or logged here. The PHI sweep enforces that claim in CI for a small, high-confidence set of patterns. It is a tripwire, not a complete PHI validator.

### What the sweep catches

| Rule | Pattern | Rationale |
|---|---|---|
| `ssn` | US Social Security Number format (`NNN-NN-NNNN`), with invalid SSA ranges (area 000, 666, 9xx; group 00; serial 0000) excluded. | The format is unique enough that a match in this repo would be either a real SSN or a deliberately-fake one with no business in the source tree. |
| `us-phone` | US 10-digit phone number in `(NNN) NNN-NNNN`, `NNN-NNN-NNNN`, or `NNN.NNN.NNNN` form. | A phone number in source code is almost never a legitimate test fixture and never PHI. |
| `email-non-allowlisted` | Any email address whose domain is not on the allowlist of public references (FHIR standards bodies, AWS docs, GitHub, the synthetic SMART sandbox, etc.). | Catches accidental commit of personal email addresses without false-positiving on legitimate references in code samples. |

### What the sweep deliberately does NOT catch

| Pattern | Why excluded |
|---|---|
| Personal names | Way too many false positives in source identifiers (`getPatient`, `defaultPatient`, etc.). |
| Dates of birth | Collide with ISO 8601 timestamps in audit log examples and CHANGELOG release dates. |
| Free-text medical notes | Out of scope for a regex-based check; would need NLP. |
| Generic medical record numbers | No universal format; flagging would be guesswork. |
| Diagnosis or terminology codes (ICD-10, SNOMED CT, LOINC) | Public reference data, not PHI. |

The narrower the check, the higher its signal-to-noise ratio. The categories above are addressed instead by the broader controls in [`hipaa-compliance-mapping.md`](hipaa-compliance-mapping.md), the SHA-256 hashing in `src/audit/logger.ts`, and the structural fact that this repository only ever talks to a public synthetic sandbox.

### Running it

```fish
pnpm check:phi
# or
node scripts/check-phi.mjs
```

The script exits `0` on a clean sweep and `1` on findings. CI runs it on every push and pull request.

### When findings appear

A finding is a candidate, not a confirmed leak. The right move depends on what was matched:

- **An email domain** that is a legitimate public reference: add it to `ALLOWED_EMAIL_DOMAINS` in `scripts/check-phi.mjs` in the same PR. Do not add personal or organization-internal email domains.
- **An SSN- or phone-shaped string** that is genuinely test data: remove it. The sweep does not have a per-rule allowlist on purpose. If a fixture truly needs that shape, it belongs outside the repository or behind a documented exemption in this file.

## Repo-settings checklist

The following toggles live in GitHub settings, not in code, and should be on for this repository:

- Settings > Code security > **Private vulnerability reporting**: enabled.
- Settings > Code security > **Dependabot alerts**: enabled.
- Settings > Code security > **Dependabot security updates**: enabled (auto-PR on advisory).
- Settings > Code security > **Secret scanning** + **Push protection**: enabled.
