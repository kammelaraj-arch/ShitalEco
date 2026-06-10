# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

COPY apps/service/package.json ./

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --no-frozen-lockfile --ignore-scripts

COPY apps/service/ ./

ARG VITE_API_URL=/api/v1
# Default to root '/' — the service app is served at its own subdomain
# (service.shital.org.uk). CI's docker-build step still passes VITE_BASE=/
# explicitly, but having the default match avoids surprise breaks if CI
# ever forgets to set the build-arg.
ARG VITE_BASE=/
ARG VITE_PAYPAL_CLIENT_ID=
ARG GIT_SHA=dev
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BASE=${VITE_BASE}
ENV VITE_PAYPAL_CLIENT_ID=${VITE_PAYPAL_CLIENT_ID}
RUN pnpm run build
RUN echo "Built commit ${GIT_SHA}"

# ─── Stage 2: Serve with nginx ────────────────────────────────────────────────
FROM nginx:alpine AS production

# Bake the git SHA into the image so deployers / admins can verify which
# commit is actually serving without docker-exec'ing into the container.
# Exposed via /version.txt (no-cache so it's never served stale).
ARG GIT_SHA=dev
ARG BUILD_TIME=
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf '%s\n' "${GIT_SHA}" > /usr/share/nginx/html/version.txt \
 && printf '{"git_sha":"%s","build_time":"%s"}\n' "${GIT_SHA}" "${BUILD_TIME}" \
      > /usr/share/nginx/html/version.json

RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml;\n\
\n\
    # Version probes — never cached, so deploy verification always reads fresh.\n\
    location = /version.txt {\n\
        add_header Cache-Control "no-store" always;\n\
        default_type text/plain;\n\
    }\n\
    location = /version.json {\n\
        add_header Cache-Control "no-store" always;\n\
        default_type application/json;\n\
    }\n\
\n\
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
        add_header Cache-Control "no-cache, no-store, must-revalidate";\n\
        add_header Pragma "no-cache";\n\
        add_header Expires "0";\n\
    }\n\
\n\
    # Key undertaking signing — public, token in URL path. Single static\n\
    # HTML reads the token from window.location and calls the API. Match\n\
    # /key-undertaking/<anything> so we don\x27t need a separate route per\n\
    # token.\n\
    location ^~ /key-undertaking/ {\n\
        try_files /key-undertaking/index.html =404;\n\
        add_header Cache-Control "no-cache, no-store, must-revalidate";\n\
    }\n\
\n\
    location /health {\n\
        return 200 '"'"'{"status":"healthy","service":"service-portal"}'"'"';\n\
        add_header Content-Type application/json;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO /dev/null http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
