FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --unsafe-perm

# Copy source files for Vite build
COPY index.html vite.config.js ./
COPY src/ ./src/

# Build the Vite app
RUN node node_modules/vite/bin/vite.js build

# ── Manager: Dashboard + Docker API ──────────────────────────────
FROM node:22-alpine AS manager

WORKDIR /app
RUN apk add --no-cache dumb-init curl docker-cli docker-compose-v2

COPY package.json package-lock.json ./
RUN npm ci --production --ignore-scripts --unsafe-perm

COPY src/manager-server.cjs ./
COPY src/dashboard.html ./dashboard.html
COPY scripts/ scripts/

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "manager-server.cjs"]

# ── Production: Vite app via nginx ────────────────────────────────
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html

# Custom nginx config
COPY <<'NGINX_CONF' /etc/nginx/conf.d/default.conf
server {
    listen 3000;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/javascript image/svg+xml;
    gzip_min_length 1000;

    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    location /api/ {
        proxy_pass http://manager:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
}
NGINX_CONF

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
