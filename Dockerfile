# syntax=docker/dockerfile:1.7

# ---- build stage -----------------------------------------------------------
FROM node:25-alpine AS build

WORKDIR /app

# Install deps from lockfile for a reproducible build
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies before copying node_modules into the runtime stage
RUN npm prune --omit=dev


# ---- runtime stage ---------------------------------------------------------
FROM node:25-alpine AS runtime

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
