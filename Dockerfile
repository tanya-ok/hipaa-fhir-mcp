# syntax=docker/dockerfile:1.7

# ---- build stage -----------------------------------------------------------
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build

# Build needs dev dependencies (TypeScript, vitest) so NODE_ENV is explicit
# here; some tools (npm, pnpm, third-party post-installs) read it to decide
# whether to install or skip dev deps.
ENV NODE_ENV=development

WORKDIR /app

# Node 25+ no longer bundles Corepack; it activates the pnpm pinned in package.json
RUN npm install -g corepack@0.36.0 && corepack enable

# Install deps from lockfile for a reproducible build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Switch to production for the prune so install scripts and tooling pick the
# production code path. The actual prune is driven by `--prod` regardless,
# but keeping the env consistent with intent matters for any post-install.
ENV NODE_ENV=production
RUN pnpm prune --prod


# ---- runtime stage ---------------------------------------------------------
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS runtime

# Production defaults. The audit logger (src/audit/logger.ts) writes to stderr
# unless AUDIT_LOG_FILE is set, so a log collector or sidecar can pick it up.
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app

# Run as the non-root `node` user that ships with the official image (uid 1000)
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist          ./dist
COPY --chown=node:node package.json                    ./

USER node

# MCP transport is stdio. No port to expose. The container is intended to be
# launched by an MCP host that pipes JSON-RPC over stdin/stdout.
# stdio by default; run "dist/http-server.js" as the command for Streamable HTTP.
ENTRYPOINT ["node"]
CMD ["dist/server.js"]
