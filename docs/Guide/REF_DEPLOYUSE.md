<!--
파일: REF_DEPLOYUSE.md
설명: Render(FastAPI 백엔드) + Vercel(React 프론트엔드) 프로덕션 배포 환경 설정 가이드. 환경변수, Dockerfile 경로, 빌드 명령, Supabase 연동 설정 포함.
업데이트: 2026-04-06
-->
# 배포 가이드 (Render + Vercel)

## 구성 개요

| 플랫폼 | 역할 | URL |
|--------|------|-----|
| **Render** | FastAPI 백엔드 | `https://autoeval-uccr.onrender.com` |
| **Vercel** | React 프론트엔드 | `https://autoeval-v1.vercel.app` |
| **Supabase** | PostgreSQL + pgvector | Supabase 대시보드 |

---

## Render (백엔드)

### 배포 설정

- **Build Type**: Docker
- **Dockerfile Path**: `backend/Dockerfile`
- **Build Context**: 루트 (`/`)

### 환경변수

| 키 | 값 |
|----|-----|
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `GOOGLE_API_KEY` | Google API 키 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_KEY` | Supabase service_role 키 |
| `CORS_ORIGINS` | `https://autoeval-v1.vercel.app` |
| `PORT` | Render가 자동 주입 (설정 불필요) |

> `PORT`는 Render가 동적으로 할당·주입 → `main.py`에서 `os.getenv("PORT", 8000)`으로 대응

### Cold Start 주의

Render 무료 티어는 비활성 시 컨테이너 종료 → 첫 요청 시 30~60초 대기
→ 첫 CORS preflight가 실패처럼 보일 수 있음 (실제 CORS 설정 문제 아님)
→ 재시도 시 정상 응답 (프론트에서 재시도 로직 적용 권장)

---

## Vercel (프론트엔드)

### 배포 설정

| 항목 | 값 |
|------|-----|
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

### 환경변수

| 키 | 값 |
|----|-----|
| `VITE_API_URL` | `https://autoeval-uccr.onrender.com` |

> `VITE_` 접두사 필수: Vite 빌드 시점에 번들에 정적 삽입됨

### 환경변수 미설정 시 동작

```ts
// frontend/src/lib/api.ts
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
```
- Vercel 배포: `VITE_API_URL` → Render URL 사용
- 로컬 개발: fallback → `http://localhost:8000`
- Docker 프로덕션: 빈 문자열 → nginx `/api/` 프록시 사용

---

## CORS 설정

### 백엔드 (`backend/main.py`)

```python
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 환경별 CORS_ORIGINS 값

| 환경 | CORS_ORIGINS |
|------|-------------|
| 로컬 | `http://localhost:3000,http://localhost:5173` |
| Render (웹 배포) | `https://autoeval-v1.vercel.app` |
| Docker 프로덕션 | `.env`에서 설정 |

---

## 배포 흐름

```
코드 push → GitHub main
  ├── Render: backend/Dockerfile로 자동 빌드·배포
  └── Vercel: frontend/ 자동 빌드·배포
```

### 수동 재배포

- **Render**: 대시보드 → Manual Deploy
- **Vercel**: 대시보드 → Redeploy 또는 `vercel --prod`

---

## 로컬 vs Docker vs 웹 비교

| 항목 | 로컬 개발 | Docker 프로덕션 | Render+Vercel |
|------|----------|----------------|---------------|
| 백엔드 URL | `localhost:8000` | `server:8000` (내부) | Render URL |
| 프론트 접근 | `localhost:5173` | `localhost:3000` | Vercel URL |
| API 라우팅 | 직접 접근 | nginx 프록시 | Vercel → Render 직접 |
| CORS 설정 | localhost 허용 | 불필요 (same-origin) | Vercel URL 허용 |
| VITE_API_URL | 미설정 | 빈 문자열 | Render URL |

---

## 체크리스트

**Render 배포 전**
- [ ] `CORS_ORIGINS`에 Vercel URL 포함 여부
- [ ] `SUPABASE_URL`, `SUPABASE_KEY` 설정
- [ ] LLM API 키 모두 설정
- [ ] Dockerfile 경로: `backend/Dockerfile`

**Vercel 배포 전**
- [ ] `VITE_API_URL`에 Render URL 설정
- [ ] Root Directory: `frontend`
- [ ] Build Command: `npm run build`
