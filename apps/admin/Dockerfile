# Admin Portal — Next.js 15 with pnpm workspace
FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
WORKDIR /app

# ── Install deps ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc* ./
COPY apps/admin/package.json ./apps/admin/
RUN pnpm install --frozen-lockfile --filter @shital/admin... \
 || pnpm install --filter @shital/admin...

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/admin/node_modules ./apps/admin/node_modules
COPY apps/admin ./apps/admin
WORKDIR /app/apps/admin
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm build
ARG GIT_SHA=dev
RUN echo "Built commit ${GIT_SHA}"

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs nextjs
# outputFileTracingRoot=workspace root → standalone mirrors workspace path:
#   server.js lives at apps/admin/server.js, static at apps/admin/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static
USER nextjs
EXPOSE 3001
ENV PORT=3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/admin',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "apps/admin/server.js"]
