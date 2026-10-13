## Summary

<!-- What changed and why. -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build` pass
- [ ] `pnpm check` and `pnpm check:phi` pass
- [ ] Synthetic data only; no PHI, credentials or real identifiers
- [ ] Audit invariant kept: one record per tool call, patient ids only as HMAC
- [ ] `docs/hipaa-compliance-mapping.md` updated if audit, security, FHIR client or transport code changed
- [ ] `CHANGELOG.md` updated for user-visible changes
