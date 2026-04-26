# syntax=docker/dockerfile:1.7

# ---- build stage -----------------------------------------------------------
FROM node:25-alpine AS build

# Build needs dev dependencies (TypeScript, vitest) so NODE_ENV is explicit
# here; some tools (npm, pnpm, third-party post-installs) read it to decide
# whether to install or skip dev deps.
ENV NODE_ENV=development

WORKDIR /app

# Activate the pnpm version pinned in package.json via Corepack
RUN corepack enable

# Install deps from lockfile for a reproducible build
COPY package.json pnpm-lock.yaml ./
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
FROM node:25-alpine AS runtime

# Production defaults. The audit logger (src/audit/logger.ts) writes to stdout
# when NODE_ENV=production so a CloudWatch agent or sidecar can pick it up.
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
ENTRYPOINT ["node", "dist/server.js"]
