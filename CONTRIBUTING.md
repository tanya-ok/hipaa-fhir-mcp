# Contributing

This is a synthetic-data prototype. Never add PHI, real patient identifiers,
credentials or audit keys to code, tests, fixtures, docs or issues.

## Setup

- Node 26 (`.nvmrc`).
- pnpm, pinned by `packageManager` in `package.json`.

```sh
pnpm install --frozen-lockfile
```

## Checks

Run before every commit:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm check:phi
pnpm audit --audit-level moderate
```

Biome is the only linter and formatter. Run `pnpm exec biome check --write <files>`
on the files you changed.

## Commits

Format: `type(scope): Subject`, where type is one of `feat`, `fix`, `docs`,
`ci`, `chore`, `refactor`, `test`, `security`, `perf`. Subject capitalized,
no trailing period. Never bypass hooks with `--no-verify`.

## Pull requests

Keep changes focused. Update `docs/hipaa-compliance-mapping.md` when audit,
security, FHIR client or transport code changes, and `CHANGELOG.md` for
user-visible changes. Report security issues through [SECURITY.md](SECURITY.md).
