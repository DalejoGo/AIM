# API Playground (NestJS) for Render (DEC-014). Build from the monorepo root:
#   docker build -f apps/api/Dockerfile -t aim-api .
# Node 22.23.4 was released 2026-10-20 (DEC-002: 14 days); the digest pins the exact image.
# The official Docker Hub image through AWS's public mirror (same digest): Render's shared build IPs hit Docker Hub's
# anonymous pull limit.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22.23.4-alpine3.24@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202

# --- build: install with the lockfile, compile, then keep only production dependencies -----------------
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
# pnpm version comes from "packageManager" in the root package.json.
RUN corepack enable
WORKDIR /repo

# Manifests first, so the install layer is cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
# --frozen-lockfile: install exactly what the lockfile says; pnpm-workspace.yaml (minimumReleaseAge,
# onlyBuiltDependencies) applies as in local installs.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @aim/api...

COPY packages/config packages/config
COPY apps/api apps/api
RUN pnpm --filter @aim/api build

# Self-contained folder with dist/ and production node_modules only. --legacy: the workspace does not set
# inject-workspace-packages, and the API has no workspace packages among its runtime dependencies.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @aim/api deploy --prod --legacy /out

# --- runtime: no pnpm, no compilers, no source; runs as the unprivileged "node" user --------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER node
EXPOSE 3000
# Render sets PORT; main.ts reads PORT, then API_PORT, then 3000. Nest's shutdown hooks handle SIGTERM.
CMD ["node", "--enable-source-maps", "dist/main.js"]
