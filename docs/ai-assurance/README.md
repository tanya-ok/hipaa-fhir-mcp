# Proposed AI Assurance profile

**Pending maintainer review. No installation or execution evidence is included.**

Scope: Synthetic FHIR input/response minimization and stdio audit tests; no real PHI, clinical backend or HIPAA certification.

Prepared base: `13debbbdf02f5329da1697d0a0b09c93dffe76f3`.
This base revision is not published; verify its remote availability before opening.
Candidate source: AI Assurance 0.2.1, commit
`353d374a00b43479870a6dee300dd200529cc60c`, verified locally against an immutable Git bundle.
This source revision is not published; remote availability must be checked before adoption.
The source checkout and CLI must be trusted separately from a target lock.

| Control | Proposed bounded claim | Existing evidence surface |
|---|---|---|
| access-boundary | Only registered read tools with validated inputs are accepted; stdio identity is a documented placeholder. | `tests/mcp.test.ts`, `tests/tools.test.ts` |
| data-exposure | FHIR responses are minimized and patient identifiers are HMAC-hashed in audit records. | `tests/client.test.ts`, `tests/tools.test.ts`, `scripts/check-phi.mjs` |
| untrusted-instructions | Untrusted FHIR response shapes are rejected rather than becoming tool authority. | `tests/client.test.ts`, `tests/mcp.test.ts` |
| consequential-actions | Invalid tool requests are refused and audited before handler execution. | `tests/stdio.test.ts` |
| evidence-lineage | Success and failure invocations have a bounded audit record with request context. | `tests/tools.test.ts`, `tests/stdio.test.ts` |
| bounded-claims | The source keeps synthetic-only and production-stub limitations explicit. | `README.md`, `docs/hipaa-compliance-mapping.md` |

CI workflow: `.github/workflows/ci.yml`. Candidate checks: `verify`.
These names come from workflow definitions. Before accepting records, match the
actual provider job names, exact project commit, completed job conclusion and
run URL. A CI suite's success is coarse evidence; it cannot establish untested
claims or substitute for review of individual test coverage.

All six controls are proposed for scoped review, with missing proof retained as
`not_verified`. This is not an accepted applicability decision. Only a maintainer
may approve or change applicability. Any future exclusion needs rationale and
`decided_by`. Agents must not manufacture executed records or approve exclusions.

The verify job is a coarse CI gate. Document review is not automated proof. SMART OAuth/KMS stubs, real clinical authorization and semantic injection resistance remain outside this evidence.

## Adoption gate

1. Review claims and approve the project-specific profile; keep limitations.
2. Use a trusted collector to select real CI evidence for an existing full
   40-hex project commit, a non-future timestamp, and a run URL or artifact hash.
   The current installer also requires publicly verifiable GitHub run/job metadata.
3. Keep records outside this proposal until independently collected. There are
   no empty evidence arrays or fabricated execution outcomes here.
4. Obtain explicit installation approval. Then use the separately reviewed CLI,
   source commit and approved candidate. Do not install by copying this directory.

`proposal.json` is a review envelope, deliberately not an installer input.
No `.ai-assurance/` directory, managed AGENTS block, workflow, dependency, tracker
integration or model call is added. No publication, deployment or certification
is implied. Linear and other trackers remain optional adapters.
