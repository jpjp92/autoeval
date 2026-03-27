# ── Stage 1: 빌드 ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# 의존성 레이어 (package.json/lock만 먼저 복사해 캐시 활용)
COPY package*.json ./
RUN npm ci

# 소스 복사
COPY . ./

# VITE_API_URL: 빌드 시 주입 (빈값이면 /api/... 상대경로 → nginx 프록시)
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ── Stage 2: 서빙 ──────────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
