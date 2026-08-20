# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --unsafe-perm

COPY . .
RUN node node_modules/vite/bin/vite.js build

# ---
# Production: static file server via nginx
# ---
FROM nginx:alpine AS production

# Custom nginx config: gzip + cache headers
COPY --from=builder /app/dist /usr/share/nginx/html
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
}
NGINX_CONF

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
