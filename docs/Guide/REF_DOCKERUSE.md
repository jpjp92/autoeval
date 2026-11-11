# Docker 구성

업데이트: 2026-11-09. 설치·실행 명령은 [SETUP_DOCKER.md](SETUP_DOCKER.md)를 참고한다.

## 파일과 역할

| 파일 | 역할 |
| --- | --- |
| `docker-compose.yml` | FastAPI + Next.js 운영 구성 |
| `docker-compose.dev.yml` | 소스 마운트, backend reload, Next.js Fast Refresh |
| `backend/Dockerfile` | Python 3.12, uv lock 기반 의존성 설치 |
| `frontend/Dockerfile` | Node 22 빌드 → Next.js standalone 실행 |
| `frontend/Dockerfile.dev` | Node 22, npm ci, npm run dev |
| `frontend/next.config.ts` | API 프록시와 standalone 출력 |

## 운영 구성

| 서비스 | 컨테이너 포트 | 호스트 포트 | 실행 |
| --- | ---: | ---: | --- |
| server | 8000 | 8000 | `/app/.venv/bin/python backend/main.py` |
| client | 3000 | 3000 | `node server.js` |

백엔드는 빌드 시 `uv sync --frozen --no-dev`로 설치한 환경을 직접 실행한다.
프론트는 `.next/standalone`과 `.next/static`을 복사하고 node 사용자로 실행한다.
API 요청은 Next.js rewrites → `http://server:8000`으로 전달한다.

문서 처리 API의 이전 nginx 설정과 맞춰 Next.js 프록시 대기 시간은 300초,
본문 버퍼 한도는 200MB로 설정한다. 본문이 메모리에 버퍼링되므로 대용량 업로드의
동시 처리 수와 컨테이너 메모리도 함께 고려한다. 이 설정은 Vercel 등 플랫폼의
별도 요청 제한을 변경하지 않는다.

백엔드 `/health`가 정상일 때 운영 client가 시작된다. client 헬스체크는 `/` 응답을
검사하며 `/health`는 프론트에서 백엔드까지의 프록시 확인에 사용한다.

## 개발 구성

- 백엔드: `./backend:/app/backend`를 마운트하고 `/app/backend`만 감시한다.
- 프론트: `./frontend:/app`를 마운트한다.
- `/app/node_modules`, `/app/.next`는 컨테이너 전용 익명 볼륨으로 분리한다.
- 개발 client는 server 프로세스 시작 후 실행하며, 준비 여부는 헬스체크로 확인한다.
- 개발·운영 모두 client 포트는 3000이다.

## 환경변수

루트 `.env`는 Compose의 server.env_file로 주입한다. API 키와 Supabase 키를
프론트에 복사하지 않는다. 양쪽 `.dockerignore`가 `.env` 파일을 빌드에서 제외한다.

| 설정 | 위치 | 적용 시점 |
| --- | --- | --- |
| `GOOGLE_API_KEY`, `OPENAI_API_KEY` | 루트 `.env` → server | 컨테이너 생성 시 |
| `SUPABASE_URL`, `SUPABASE_API_KEY` | 루트 `.env` → server | 컨테이너 생성 시 |
| `ANTHROPIC_API_KEY` | 루트 `.env` → server, 선택 사항 | 컨테이너 생성 시 (Claude 보류 중, 과거 결과 호환용) |
| `LANGCHAIN_TRACING_V2`, `LANGCHAIN_ENDPOINT`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT` | 루트 `.env` → server, 선택 사항 | 컨테이너 생성 시 (LangSmith 추적) |
| `LOG_LEVEL`, `CORS_ORIGINS` | 루트 `.env` → server, 선택 사항 | 컨테이너 생성 시 (개발 모드는 `LOG_LEVEL=DEBUG` 고정) |
| `BACKEND_API_URL=http://server:8000` | client 빌드 인자 / 개발 environment | 운영 빌드 시 / 개발 서버 시작 시 |
| `NEXT_PUBLIC_UPLOAD_BASE_URL` | client 빌드 인자, 선택 사항 | 빌드 시, 브라우저에 공개 |

임베딩은 `gemini-embedding-2`, 1536차원을 유지한다.
의존성 변경 시 재빌드하고, 프론트 패키지 변경 시 `--renew-anon-volumes`도 사용한다.
백엔드 `.env` 변경 시 server를 재생성한다. 프론트 빌드 인자 변경 시 client를 재빌드한다.

## 검증 기록

2026-11-11, WSL2 Ubuntu 24.04 / Docker 29.9.3 / Compose v5.7.0에서 개발 구성을 검증했다.
`config --quiet` 통과, `up -d --build --wait` 후 server·client 모두 healthy,
`localhost:8000/health`, `localhost:3000/health`(프록시), `localhost:3000/` 모두 200.
첫 빌드는 의존성 설치 때문에 10분 이상 걸릴 수 있다. 운영 구성은 아직 별도 검증 전이다.

`backend/Dockerfile`은 `ghcr.io/astral-sh/uv:latest`를 사용하므로 빌드 시점마다 uv 버전이
달라질 수 있다. 재현성이 필요하면 태그를 고정한다.
