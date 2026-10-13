# Publication and demonstration gates

This page defines acceptance criteria, not an approval badge. Publication stays
separate from local preparation. No remote deployment is implied by a successful
local documentation build.

## Reproduce the project

Run from a fresh checkout with the documented runtime and package manager:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm check:phi
```

Follow the [demonstration guide](demo.md). Capture the source revision, environment,
command, observed positive and negative outcomes and cleanup result. Saved
screenshots or an older report must identify their capture date. Re-run an
applicable integration check after changing the behavior it exercises.

Shared SPIRE/mTLS integration, real stdio invocation and native Desktop installation checks have local evidence. OAuth/SMART, KMS and clinical authorization gaps remain explicit.

## Build the documentation

Documentation tooling is separate from the application runtime:

```sh
python3 -m venv .venv-docs
.venv-docs/bin/python -m pip install -r requirements-docs.txt
.venv-docs/bin/zensical build --strict --clean
.venv-docs/bin/zensical serve --dev-addr 127.0.0.1:8000
```

The pinned generator produces `site/`. Check navigation, code blocks, diagrams,
search and project-subpath asset URLs in a browser. Never add private overlays,
state databases, credentials or private vaults to documentation sources.

## GitHub Pages handoff

The prepared workflow builds on pull requests and publishes only from `main`
after an authorized push or explicit workflow dispatch. It uploads the static
`site/` directory and uses the GitHub Pages environment with job-scoped
`pages: write` and `id-token: write`; no long-lived deploy key is required.
The repository owner must select GitHub Actions as the Pages source before the
first deployment. Preparing this file does not enable Pages or execute a deploy.

Before publication, inspect the exact staged diff and distributable contents,
run the repository privacy/secret gates, reproduce the demo from a clean checkout,
verify the strict docs build and retain its evidence. Remote CI and the resulting
Pages URL still need verification after publication is explicitly authorized.

Generator behavior and configuration follow the
[official Zensical guide](https://zensical.org/docs/create-your-site/).

## Local evidence on 2026-10-07

The 51 tests, types, build, Biome and PHI-shape sweep passed after raising the
MCP SDK dependency floor to 1.31.0; the locked SDK resolves to 1.32.1. A clean
source copy installed with the frozen lockfile and built successfully on Node
26.10.0 / pnpm 10.33.2. The eight-call real stdio/local verified HTTPS demo
passed, including rejected inputs, backend failures, recovery and cleanup.
The backend fixtures are synthetic. Native Desktop remains a separate manual
integration check, not evidence from the stdio harness.

The runtime audit reported zero advisories for the updated source lockfile on
this date. The [SDK advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h)
concerns OAuth HTTP clients; it explicitly excludes MCP servers and stdio
clients. This update removes the affected package version without claiming
that the demonstrated server was exploitable through that client-only path.
A dated advisory scan and the PHI-shape sweep do not prove clinical compliance.

## Retained package evidence

| Runtime revision | Local archive | SHA-256 |
|---|---|---|
| `f537208` | `hipaa-fhir-mcp-0.3.0.tgz` | `23f2f96dff52b01b7a5a469bb02ed962b6e0254f0df6f63e517b25af274983a5` |

The independently installed archives passed their actual-process demo on
2026-10-07, including refused inputs and owned-process/data cleanup. The FHIR
server uses real stdio and local verified HTTPS with synthetic responses.
The source build and package installation used pnpm 10.33.2; `npm pack`
produced the archive. These are local demonstrations,
not production or remote CI evidence.

## Desktop bundle checks

```sh
pnpm check:mcpb
pnpm package:mcpb
python3 scripts/check-mcpb.py hipaa-fhir-mcp.mcpb
```

The packer stages only fresh compiler-reported runtime files, manifest, license, package
metadata and locked production dependencies. It uses a hoisted dependency tree
so the extracted bundle does not depend on pnpm symlinks. Installation scripts
are disabled. The MCPB tool is pinned to 2.1.2. The complete ZIP payload gate
refuses unexpected roots, private state, credentials, symbolic links, duplicate
paths and path traversal before a bundle is delivered. Existing output is never
overwritten. Temporary packaging state is removed on success or failure.

The actual stdio demo must also pass from the extracted archive. This checks
packaged runtime behavior, not the Desktop extension installer or secret
storage. Native installation is a separate manual check. No release artifact or
compatibility badge is published by this command.

Claude Desktop's built-in Node runtime is 24.x. The manifest requires Node 26
or newer, so Desktop runs the server with the system Node 26 found on its
`PATH`. Reinstalling the same id and version does not replace the installed
files; uninstall the extension before installing a rebuilt bundle.

Packaging follows the [official MCPB CLI contract](https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md).

### Executed bundle evidence - 2026-10-12

The local bundle contains 2385 entries and no pnpm workspace metadata or
local user-path matches. SHA-256: `48dc7919c51173fe651ed54157579096ea37b8be220aff8007c701ba0cb90789`.
The extracted archive passed the actual stdio/verified synthetic HTTPS demo on
Node 26.10.0: eight invocations, eight audit records, two refusals before the
backend, recovery and cleanup. The five archive-gate tests cover accepted
payloads, private paths and package-manager metadata, traversal, symlinks and
development metadata. All 51 application tests, types, build, Biome and the
PHI sweep passed. Native Desktop installation and its bundled runtime remain
unverified; no release or remote CI was run.

### Native Desktop installation - 2026-10-13

The local bundle was installed natively in Claude Desktop on macOS. The
extension connected and listed three tools. `get_patient` against the public
SMART sandbox returned a synthetic patient. The audit record contained only
`patient_id_hmac` for the patient, with caller_identity `claude-desktop-local`.
No release or remote CI was run.

## Revision references

Revision hashes in dated records that do not resolve in this repository identify
development commits. They were squashed into the 2026-10-13 release commit and are
archived locally. The release tree was checked again after the squash.
