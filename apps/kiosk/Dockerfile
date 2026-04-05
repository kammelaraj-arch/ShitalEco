# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

# Copy only kiosk's own package.json (no workspace needed)
COPY package.json ./

# Skip ALL postinstall scripts:
#  - ELECTRON_SKIP_BINARY_DOWNLOAD=1  → stops electron downloading 200MB binary
#  - --ignore-scripts                 → skips @capacitor/android SDK setup etc.
# Vite + React have no critical postinstall, so builds work fine.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Copy source
COPY . .

# Build web-only bundle
ARG VITE_API_URL=/api/v1
ARG VITE_BASE=/kiosk/
ARG VITE_BRANCH_ID=main
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BASE=${VITE_BASE}
ENV VITE_BRANCH_ID=${VITE_BRANCH_ID}
RUN pnpm run build:web

# ─── Stage 2: Serve with nginx ────────────────────────────────────────────────
FROM nginx:alpine AS production

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA nginx config: serve the kiosk at '/' inside this container.
# The reverse proxy (shital.conf) maps /kiosk/ -> http://kiosk:80/
# Vite is built with base='/kiosk/' so asset paths already contain the prefix.
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml;\n\
\n\
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
\n\
    # SPA fallback — never cache HTML so new bundles are always picked up\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
        add_header Cache-Control "no-cache, no-store, must-revalidate";\n\
        add_header Pragma "no-cache";\n\
        add_header Expires "0";\n\
    }\n\
\n\
    location /health {\n\
        return 200 '"'"'{"status":"healthy","service":"kiosk"}'"'"';\n\
        add_header Content-Type application/json;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
