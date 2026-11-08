# 배포 구성 요약

업데이트: 2026-11-09. 저장소 설정 기준. 실제 서비스 상태는 별도로 확인한다.

| 구성 | 역할 | 설정 |
| --- | --- | --- |
| Render | FastAPI 백엔드 | `backend/Dockerfile`, 루트 빌드 컨텍스트 |
| Vercel | Next.js 16.4.5 프론트 | Root Directory=frontend, Framework=Next.js |
| 로컬 Docker | server + client | 8000 / 3000 포트 |

```text
로컬: localhost:3000/api/... → Next.js → 127.0.0.1:8000/api/...
Docker: localhost:3000/api/... → Next.js → server:8000/api/...
Vercel: 프론트 /api/... → Next.js → BACKEND_API_URL/api/...
```

- 서버 전용 프록시 주소: BACKEND_API_URL.
- 선택적 직접 업로드 주소: NEXT_PUBLIC_UPLOAD_BASE_URL (브라우저 공개).
- API_BASE는 빈 문자열로 유지한다.
- 루트 `.env`의 API 키·Supabase 키는 백엔드에서만 사용한다.
- Render의 PORT는 main.py가 읽는다.
- 외부 헬스 모니터링에는 `/health` GET 또는 HEAD를 사용할 수 있다.
  이는 프로세스 확인이며 모델·DB 검증은 아니다.

상세 절차: [배포](REF_DEPLOYUSE.md), [Docker](SETUP_DOCKER.md),
[모델](MODEL_CONFIGURATION.md), [프론트 보안](FRONTEND_SECURITY.md).
