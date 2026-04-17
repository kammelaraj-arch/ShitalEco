# Admin Portal — Next.js static export served by nginx:alpine
# No Node.js runtime in production: no OOM, no crashes, ~8MB memory usage.
FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /app

# ── Install deps ───────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY apps/admin/package.json ./apps/admin/
RUN pnpm install --frozen-lockfile --filter @shital/admin... \
 || pnpm install --filter @shital/admin...

# ── Build static export ────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/admin/node_modules ./apps/admin/node_modules
COPY apps/admin ./apps/admin
WORKDIR /app/apps/admin
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm build
# output: 'export' produces apps/admin/out/
ARG GIT_SHA=dev
RUN echo "Built commit ${GIT_SHA}"

# ── Runtime — pure nginx, no Node.js ──────────────────────────────────────────
FROM nginx:alpine AS runner
# Copy static export
COPY --from=builder /app/apps/admin/out /usr/share/nginx/html
# nginx config: serve files, SPA fallback for client-side routing
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost/admin/ || exit 1
