# 배포 가이드 (Render + Vercel)

업데이트: 2026-11-09. 저장소 설정 기준이며 실제 원격 배포 완료를 의미하지 않는다.

## 구성

| 플랫폼 | 역할 | 기존 대상 주소 |
| --- | --- | --- |
| Render | FastAPI | `https://autoeval-uccr.onrender.com` |
| Vercel | Next.js App Router | `https://autoeval-v1.vercel.app` |
| Supabase | PostgreSQL + pgvector | 환경변수로 지정 |

## Render

- Build Type: Docker
- Dockerfile: `backend/Dockerfile`
- Build Context: 저장소 루트
- 실행: 이미지의 `/app/.venv/bin/python backend/main.py`
- PORT는 플랫폼이 주입하며 main.py가 사용한다.

| 환경변수 | 용도 |
| --- | --- |
| `GOOGLE_API_KEY` | Gemini 생성·Judge·문서 처리·임베딩 |
| `OPENAI_API_KEY` | GPT 생성·Judge |
| `ANTHROPIC_API_KEY` | 보류 중, 현재 UI 모델 선택에 사용하지 않음 |
| `SUPABASE_URL` | DB 주소 |
| `SUPABASE_API_KEY` | 백엔드 DB 인증 |
| `CORS_ORIGINS` | 브라우저가 직접 백엔드를 호출할 프론트 주소 |

## Vercel

| 항목 | 값 |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | Next.js 기본값 사용, 별도 override 해제 |

`frontend/vercel.json`의 framework는 nextjs이고 outputDirectory는 null로 자동 감지한다.
기존 dist 출력 설정 대신 Next.js 기본 출력을 사용한다.
build.env에 BACKEND_API_URL과 NEXT_PUBLIC_UPLOAD_BASE_URL을 기존 Render 주소로 지정한다.
두 값은 빌드 시 필요하므로 런타임 전용 env 설정으로 대체하지 않는다.
배포 대상 주소를 변경하면 Vercel 프로젝트 설정과 저장소 설정을 함께 확인한다.

| 환경변수 | 용도 |
| --- | --- |
| `BACKEND_API_URL` | Next.js 서버의 API 프록시 대상 |
| `NEXT_PUBLIC_UPLOAD_BASE_URL` | Vercel에서는 Render 주소로 지정하여 업로드를 직접 전송 |

```ts
// frontend/src/lib/api.ts
export const API_BASE = '';
const UPLOAD_BASE = process.env.NEXT_PUBLIC_UPLOAD_BASE_URL ?? '';
```

일반 요청은 `/api/*` 상대 경로를 사용하고 next.config.ts rewrites가 백엔드에 전달한다.
업로드 주소가 비어 있으면 업로드도 같은 프록시를 사용한다. 플랫폼 업로드 제한을 초과하는
파일은 직접 업로드 주소를 설정하고 백엔드 CORS_ORIGINS에 프론트 주소를 허용한다.
현재 Vercel 설정은 직접 업로드를 기본으로 사용한다. 로컬·Docker의 빈 업로드 주소는
Next.js 프록시를 사용하며 자체 호스팅 프록시 한도는 300초·200MB이다.
플랫폼 자체의 요청 한도나 실제 서비스 메모리까지 검증한 것은 아니다.

2026-11-10 확인 시 문서의 프론트 주소 `https://autoeval-v1.vercel.app`로 보낸
Render 업로드 사전 요청(OPTIONS)은 CORS 400을 반환했다. 배포 전에 Render의
`CORS_ORIGINS`에 실제 프론트 origin을 추가하고 백엔드를 재배포한다.
기존 허용 주소는 유지하며, origin에는 경로나 마지막 `/`를 넣지 않는다.
해당 origin의 사전 요청에서 `Access-Control-Allow-Origin`이 반환되는지 확인한다.

BACKEND_API_URL과 NEXT_PUBLIC_UPLOAD_BASE_URL 변경 후에는 프론트를 재빌드한다.
API 키·Supabase 키를 NEXT_PUBLIC 변수로 만들지 않는다.

## 환경별 주소

| 항목 | 로컬 | Docker | Render + Vercel |
| --- | --- | --- | --- |
| 프론트 | localhost:3000 | localhost:3000 | Vercel 주소 |
| 백엔드 | 127.0.0.1:8000 | server:8000 (내부) | Render 주소 |
| 프록시 | Next.js rewrites | Next.js rewrites | Next.js rewrites |
| BACKEND_API_URL | 기본값 사용 | Compose가 지정 | Render 주소 |

## 배포 확인

1. Next.js 보안 기준과 lock 파일을 확인한다: [FRONTEND_SECURITY.md](FRONTEND_SECURITY.md).
2. Render 환경변수, Dockerfile 경로, DB 연결을 확인한다.
3. Vercel의 기존 정적 프론트 출력 설정을 해제하고 Next.js로 배포한다.
4. `/`, 정적 JS/CSS, `/health`, 문서 업로드와 생성·평가를 확인한다.
5. `/health`는 프로세스 응답 확인이며 DB·모델 호출 성공을 보장하지 않는다.

현재 모델과 기본값은 [MODEL_CONFIGURATION.md](MODEL_CONFIGURATION.md)를 참고한다.
로컬 Docker 명령은 [SETUP_DOCKER.md](SETUP_DOCKER.md)를 참고한다.
