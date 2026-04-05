# ─── Stage 1: Build ───
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

# Copy workspace root files for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/kiosk/package.json apps/kiosk/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @shital/kiosk... || pnpm install --filter @shital/kiosk...

# Copy source
COPY apps/kiosk/ apps/kiosk/

WORKDIR /app/apps/kiosk

# Build for production (web mode — no electron)
ARG VITE_API_URL=/api/v1
ARG VITE_BRANCH_ID=main
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BRANCH_ID=${VITE_BRANCH_ID}
RUN pnpm run build:web

# ─── Stage 2: Serve with nginx ───
FROM nginx:alpine AS production

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=builder /app/apps/kiosk/dist /usr/share/nginx/html

RUN cat > /etc/nginx/conf.d/default.conf << 'EOF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript image/svg+xml;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /health {
        return 200 '{"status":"healthy","service":"kiosk"}';
        add_header Content-Type application/json;
    }
}
EOF

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
