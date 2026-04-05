# ─── Stage 1: Build ───
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/screen/package.json apps/screen/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @shital/screen... || pnpm install --filter @shital/screen...

# Copy source
COPY apps/screen/ apps/screen/

WORKDIR /app/apps/screen

# Build
ARG VITE_API_URL=/api/v1
ARG VITE_DONATE_URL=https://shital.org.uk/donate
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_DONATE_URL=${VITE_DONATE_URL}
RUN pnpm build

# ─── Stage 2: Serve ───
FROM nginx:alpine AS production

RUN rm /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/screen/dist /usr/share/nginx/html

RUN cat > /etc/nginx/conf.d/default.conf << 'EOF'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml text/javascript image/svg+xml;

    # Cache static assets 1 year
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # HTML — no cache so new bundles always load
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    # Proxy API calls to backend
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        return 200 '{"status":"healthy","service":"shital-smart-screen"}';
        add_header Content-Type application/json;
    }
}
EOF

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
