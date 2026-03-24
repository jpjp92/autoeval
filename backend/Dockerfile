FROM python:3.12-slim

# 타임존 및 기본 유틸 설정 (curl은 docker-compose healthcheck에서 사용)
ENV TZ=Asia/Seoul
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl tzdata default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# uv 설치
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# 의존성 레이어 (pyproject.toml/uv.lock은 프로젝트 루트에 위치)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# 애플리케이션 코드
COPY backend/ ./backend/

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uv", "run", "python", "backend/main.py"]
