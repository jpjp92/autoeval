# 배포 구성 (Render + Vercel)

> 내부 참고용 — 실제 서비스 URL 및 배포 설정 정보

---

## 플랫폼 구성

| 플랫폼 | 역할             | 환경변수                                          |
| ------ | ---------------- | ------------------------------------------------- |
| Render | FastAPI 백엔드   | `CORS_ORIGINS=https://autoeval-v1.vercel.app`     |
| Vercel | React 프론트엔드 | `VITE_API_URL=https://autoeval-uccr.onrender.com` |

- Render는 `PORT` 환경변수를 자동 주입 → `main.py`에서 `os.getenv("PORT", 8000)`으로 대응
- 로컬 개발 시 Vite 프록시가 `/api/*`를 `localhost:8000`으로 포워딩 (`vite.config.ts`)
- Vercel 배포 시 `vercel.json` rewrites가 `/api/*`를 Render로 서버사이드 포워딩 → CORS 불필요

```
브라우저 요청 흐름
  로컬  : localhost:3000/api/... → Vite 프록시 → localhost:8000
  Vercel: autoeval-v1.vercel.app/api/... → Vercel rewrites → autoeval-uccr.onrender.com
```

---

## Render 슬립 방지 (UptimeRobot)

Render 무료 플랜은 **15분 비활성** 후 spin-down → 첫 요청시 15~20초 지연 발생.

| 항목       | 내용                                                             |
| ---------- | ---------------------------------------------------------------- |
| 서비스     | [UptimeRobot](https://uptimerobot.com) 무료 플랜                 |
| 모니터 URL | `https://autoeval-uccr.onrender.com/health`                      |
| 폴링 간격  | 5분 (Render 15분 슬립 기준 충분)                                 |
| 응답       | `{"status": "healthy", "timestamp": "..."}` 동적 타임스탬프 포함 |

> HEAD 요청 허용 필요: UptimeRobot 무료 플랜은 기본값 HEAD 사용 → `backend/main.py`의 `/health`를 `@app.api_route(methods=["GET", "HEAD"])`로 설정
