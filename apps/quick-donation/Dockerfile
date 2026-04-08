# ─── Stage 1: Build ───
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

# Copy workspace root files for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/quick-donation/package.json apps/quick-donation/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @shital/quick-donation... || pnpm install --filter @shital/quick-donation...

# Bust cache on every new commit so source changes are always picked up
ARG GIT_SHA=dev
RUN echo "Building commit ${GIT_SHA}"

# Copy source code
COPY apps/quick-donation/ apps/quick-donation/

WORKDIR /app/apps/quick-donation

# Build for production
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm build

# ─── Stage 2: Serve with nginx ───
FROM nginx:alpine AS production

# Custom nginx config for SPA
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/quick-donation/dist /usr/share/nginx/html

# nginx config
RUN cat > /etc/nginx/conf.d/default.conf << 'EOF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to backend
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location /health {
        return 200 '{"status":"healthy","service":"quick-donation-kiosk"}';
        add_header Content-Type application/json;
    }
}
EOF

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
