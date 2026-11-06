# BigForge container image (multi-stage, Node 24).
#
#   docker build -t bigforge .
#   docker run --rm -p 4747:4747 bigforge        # deterministic demo mode; needs no network
#
# Build contract (see package.json): `npm ci` + `npm run build` produce
#   dist/server/main.mjs       bundled API and application layer (third-party deps external)
#   dist/server/package.json   runtime dependencies, installed below with `npm install --omit=dev`
#   dist/server/forge-ci.mjs   lab tool script
#   dist/web/**                static SPA assets
#
# Notes
# - Data lives in /app/data inside the container and is lost when the container is removed.
#   Mount a volume there only for single-container local use (SQLite is single-node).
# - HEALTHCHECK is used by Docker only. Azure Container Apps ignores it and uses the HTTP
#   probes defined in infra/modules/container-app.bicep.
# - Base images are pinned to the major version tag, not to a digest.

# ---------------------------------------------------------------------------
# Stage 1: build the server bundle and the static web assets
# ---------------------------------------------------------------------------
FROM node:24-slim AS builder
WORKDIR /build

COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: minimal runtime image
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime

# Optional extra runtime packages, for example "@azure/identity" when AZURE_OPENAI_AUTH=entra
# is used and dist/server/package.json does not already list it. Empty by default.
ARG EXTRA_RUNTIME_PACKAGES=""

LABEL org.opencontainers.image.title="BigForge" \
      org.opencontainers.image.description="BigForge API and web UI (demo mode runs fully offline)" \
      org.opencontainers.image.source="https://github.com/snowjug/BigForge"

ENV HOST=0.0.0.0 \
    PORT=4747 \
    BIGFORGE_MODE=demo \
    BIGFORGE_DATA_DIR=/app/data

WORKDIR /app
RUN mkdir -p /app/data && chown -R node:node /app

# The official Node image ships an unprivileged "node" user (uid 1000).
USER node

COPY --from=builder --chown=node:node /build/dist ./dist

# Install only the runtime dependencies of the bundle. Install scripts are skipped; the
# bundle uses the built-in node:sqlite, so no native modules are needed.
RUN cd dist/server \
    && npm install --omit=dev --ignore-scripts --no-audit --no-fund ${EXTRA_RUNTIME_PACKAGES} \
    && npm cache clean --force

EXPOSE 4747

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4747) + '/api/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/server/main.mjs"]
