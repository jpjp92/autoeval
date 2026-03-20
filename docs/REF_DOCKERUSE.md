# Docker 구성

## 파일 구조

```
autoeval/
├── docker-compose.yml          # 프로덕션
├── docker-compose.dev.yml      # 개발 오버라이드
├── .env                        # 환경변수 (git 제외)
├── .env.example                # 환경변수 템플릿
├── backend/
│   └── Dockerfile              # FastAPI 백엔드
└── frontend/
    ├── Dockerfile              # React → nginx (프로덕션)
    ├── Dockerfile.dev          # Vite dev server (개발)
    └── nginx.conf              # SPA + API 프록시
```

---

## 프로덕션 구성

### `docker-compose.yml`

```yaml
services:
  server:                              # FastAPI 백엔드
    build:
      context: .
      dockerfile: backend/Dockerfile
    container_name: server
    ports:
      - "8000:8000"
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  client:                              # nginx + React 빌드
    build:
      context: .
      dockerfile: frontend/Dockerfile
      args:
        VITE_API_URL: ""               # 빈 문자열 → nginx 프록시 사용
    container_name: client
    ports:
      - "3000:80"
    restart: unless-stopped
    depends_on:
      server:
        condition: service_healthy
```

### `backend/Dockerfile`

```dockerfile
FROM python:3.12-slim
ENV TZ=Asia/Seoul
RUN apt-get update && apt-get install -y --no-install-recommends curl tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ ./backend/
ENV PYTHONPATH=/app
EXPOSE 8000
CMD ["uv", "run", "python", "backend/main.py"]
```

### `frontend/Dockerfile` (멀티스테이지)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### `frontend/nginx.conf`

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    resolver 127.0.0.11 valid=30s ipv6=off;  # Docker 내부 DNS

    location / {
        try_files $uri $uri/ /index.html;    # SPA 라우팅
    }

    location /api/ {
        set $upstream http://server:8000;    # 동적 DNS 조회 (startup 오류 방지)
        proxy_pass $upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }
}
```

> **nginx upstream 주의**: `set $upstream` 변수를 사용해야 Docker 시작 시 DNS 조회 실패(`host not found in upstream`) 방지

---

## 개발 구성

### `docker-compose.dev.yml` (오버라이드)

```yaml
services:
  server:
    volumes:
      - ./backend:/app/backend        # 소스 마운트 (핫 리로드)
    environment:
      LOG_LEVEL: DEBUG
    command: ["uv", "run", "uvicorn", "backend.main:app",
              "--host", "0.0.0.0", "--port", "8000", "--reload"]
    healthcheck:
      start_period: 60s

  client:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev      # Vite dev server 사용
    ports:
      - "3000:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules             # node_modules 마운트 제외
    depends_on:
      - server
```

### `frontend/Dockerfile.dev`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

> `--host 0.0.0.0` 필수: 컨테이너 외부에서 HMR 접근 가능

---

## 주요 명령어

```bash
# 프로덕션 빌드 및 실행
docker compose build
docker compose up -d

# 로그 확인
docker compose logs -f
docker compose logs -f server    # 백엔드만

# 중지 (컨테이너 유지)
docker compose stop
docker compose start

# 완전 종료 (컨테이너 삭제)
docker compose down

# 개발 모드 (HMR, 소스 마운트)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# 이미지 재빌드 (코드 변경 시)
docker compose build --no-cache
docker compose up -d

# 컨테이너 초기화 후 재시작
docker rm -f server client
docker compose up -d
```

---

## 포트 정리

| 서비스 | 내부 포트 | 외부 포트 |
|--------|----------|----------|
| FastAPI (server) | 8000 | 8000 |
| nginx (client) — 프로덕션 | 80 | 3000 |
| Vite dev (client) — 개발 | 5173 | 3000 |

---

## 환경변수 (`.env`)

```env
# LLM API Keys
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
OPENAI_API_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_KEY=

# Server
LOG_LEVEL=INFO
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```
