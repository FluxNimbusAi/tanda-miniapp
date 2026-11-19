# syntax=docker/dockerfile:1
# =============================================================================
# Tanda mini-app — production image (Hosting Plan B, ADR-0009)
#
# Node-only lane: plain npm + node, no pnpm/bun. This host (PC) has no docker
# daemon — the image is authored here but PROVEN in CI: the `docker-build`
# job in .github/workflows/ci.yml builds this file on every PR.
#
# Build context MUST be the repository root:
#     docker build -f hosting/Dockerfile -t tanda-miniapp .
#
# Depends on next.config.ts -> output: 'standalone': the build emits a
# self-contained .next/standalone server (NFT-traced production deps only),
# so the runtime stage ships no dev tree and no source.
# =============================================================================

ARG NODE_VERSION=26

# ---------- stage 1: deps (re-cached whenever the lockfile changes) ----------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- stage 2: build ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NOTE (go-live, ADR-0009 §Consequences): NEXT_PUBLIC_* values are INLINED at
# image-build time, not read at runtime. Deliberately NOT declared here with
# empty defaults — an empty string would shadow the request-time fallbacks in
# src/config/tanda.ts. When the go-live decision lands, add per-variable
# ARG+ENV pairs, e.g.:
#   ARG NEXT_PUBLIC_APP_ID
#   ENV NEXT_PUBLIC_APP_ID=${NEXT_PUBLIC_APP_ID}
# and pass them with --build-arg. Chain/RPC/factory/impl/USDC default to the
# ratified Sepolia-4801 values in src/config/tanda.ts.
RUN npm run build

# ---------- stage 3: runner ----------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# HOSTNAME=0.0.0.0 is REQUIRED, not cosmetic: the docker runtime injects
# HOSTNAME=<container-id> and Next's standalone server binds process.env.HOSTNAME
# — the classic standalone-in-docker "image runs, port unreachable" gotcha.
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
