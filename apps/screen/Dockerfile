# ── Shital Smart Screen — pure HTML/jQuery player ──────────────────────────
# No build step: just download JS libs + serve static files with nginx.
# Works on any TV browser: Android TV, Fire TV, Samsung Tizen, LG WebOS.
FROM nginx:alpine

# ── Download JS dependencies into the assets folder ────────────────────────
RUN apk add --no-cache curl && \
    mkdir -p /usr/share/nginx/html/assets && \
    # jQuery 3.7.1 (last 3.x — best TV browser compat)
    curl -sLo /usr/share/nginx/html/assets/jquery.min.js \
        https://code.jquery.com/jquery-3.7.1.min.js && \
    # hls.js 1.5 for HLS streaming support
    curl -sLo /usr/share/nginx/html/assets/hls.min.js \
        https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js && \
    apk del curl

# ── Copy static files ───────────────────────────────────────────────────────
COPY html/ /usr/share/nginx/html/

# ── nginx config ────────────────────────────────────────────────────────────
RUN rm -f /etc/nginx/conf.d/default.conf && cat > /etc/nginx/conf.d/screen.conf << 'NGINX'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/javascript text/javascript image/svg+xml;

    # JS/CSS — cache 1 year
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # HTML — no cache (allow content updates without redeploy)
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        # Allow embedding in iframes (for website-type slides)
        add_header X-Frame-Options "SAMEORIGIN";
    }

    # Proxy API to backend
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }

    location /health {
        return 200 '{"status":"ok","service":"shital-smart-screen"}';
        add_header Content-Type application/json;
    }
}
NGINX

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
