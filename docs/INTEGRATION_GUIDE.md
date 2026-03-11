# Frontend-Backend 연결 구현 가이드

## 📋 개요

현재 상황:
- **Frontend**: Mock UI만 있고 Backend API 호출 미구현
- **Backend**: `/api/generate` 엔드포인트가 TODO 상태
- **문제**: 생성 기능이 실제로 작동하지 않음

이 가이드는 단계별 통합 과정을 설명합니다.

---

## 🎯 Step 1: Backend API 구현

### 1.1 생성된 파일 적용

`backend/generation_api.py`에 구현된 내용을 기존 `backend/main.py`에 통합합니다.

**파일 위치**: `/home/jpjp92/devs/works/autoeval/backend/generation_api.py`

### 1.2 main.py에 통합

```python
# backend/main.py

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

# Step 1: 기존 imports 유지
from pathlib import Path
import json
import logging
from datetime import datetime

# Step 2: generation_api.py의 내용을 main.py에 추가하거나 import
from generation_api import (
    JobManager,
    GenerateRequest,
    GenerationStatus,
    JobStatus,
    run_qa_generation,
    setup_generation_routes
)

# Step 3: FastAPI 앱 초기화
app = FastAPI(
    title="Auto Evaluation API",
    description="Backend API for QA generation and evaluation",
    version="1.0.0"
)

# Step 4: CORS 설정
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Step 5: 생성 API 라우트 추가
setup_generation_routes(app)

# Step 6: 기존 API는 유지
@app.get("/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.get("/api/results")
def get_results():
    # 기존 구현...
    pass
```

### 1.3 환경 변수 확인

`.env` 파일 (backend/):
```
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
LOG_LEVEL=INFO
```

---

## 🎯 Step 2: Frontend 업데이트

### 2.1 API URL 설정

**파일**: `frontend/src/lib/api.ts`

```typescript
// API 베이스 URL (환경 변수로 관리)
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// 추가: API_BASE export (다른 파일에서 사용 가능하도록)
export { API_BASE };
```

**파일**: `frontend/.env`

```env
VITE_API_URL=http://localhost:8000
```

### 2.2 QAGenerationPanel 업데이트

**기존 파일**: `frontend/src/components/generation/QAGenerationPanel.tsx`

**개선된 버전**: `frontend/src/components/generation/QAGenerationPanel.improved.tsx`

**마이그레이션 단계**:

```bash
# Step 1: 기존 파일 백업
cp frontend/src/components/generation/QAGenerationPanel.tsx \
   frontend/src/components/generation/QAGenerationPanel.tsx.bak

# Step 2: 개선된 버전으로 교체
cp frontend/src/components/generation/QAGenerationPanel.improved.tsx \
   frontend/src/components/generation/QAGenerationPanel.tsx

# Step 3: App.tsx에서 import가 제대로 되는지 확인
# 이미 QAGenerationPanel import되어 있음
```

### 2.3 TypeScript 타입 추가 (optional)

`frontend/src/lib/api.ts`에 추가:

```typescript
// Generation 관련 타입
export interface GenerateRequest {
  model: string;
  lang: string;
  samples: number;
  qa_per_doc?: number;
  prompt_version: string;
}

export interface GenerationStatus {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  message?: string;
  error?: string;
  result_file?: string;
  timestamp?: string;
  config?: Record<string, any>;
}
```

---

## 🧪 Step 3: 테스트

### 3.1 Backend 테스트

```bash
# Backend 시작
cd /home/jpjp92/devs/works/autoeval/backend
python -m uvicorn main:app --reload --port 8000
```

**테스트 API 호출**:

```bash
# 1. Health Check
curl http://localhost:8000/health

# 2. Generation 시작
curl -X POST http://localhost:8000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "flashlite",
    "lang": "ko",
    "samples": 8,
    "prompt_version": "v2"
  }'

# 응답 예시:
# {
#   "success": true,
#   "job_id": "gen_20260311_153000_123456",
#   "message": "Generation started"
# }

# 3. Status 확인 (job_id는 위의 응답에서 얻은 ID)
curl http://localhost:8000/api/generate/gen_20260311_153000_123456/status

# 4. Jobs 목록
curl "http://localhost:8000/api/generate/jobs?status=completed&limit=10"
```

### 3.2 Frontend 테스트

```bash
# Frontend 시작
cd /home/jpjp92/devs/works/autoeval/frontend
npm run dev

# 브라우저에서 http://localhost:5173 접속
# → "Data Generation" 탭 클릭
# → "생성 및 평가 시작" 버튼 클릭
# → Terminal output에 실제 진행 상황 표시됨
```

### 3.3 통합 테스트

1. **Frontend에서 생성 시작**
2. **Backend에서 실제 작동 확인**
3. **실시간 진행률 업데이트 확인**
4. **완료 후 결과 파일 생성 확인**

```bash
# 결과 파일 확인
ls -lh /home/jpjp92/devs/works/autoeval/output/
```

---

## 🔧 Step 4: 실제 생성 로직 연결 (Optional)

### 4.1 현재 상황

`backend/generation_api.py`의 `run_qa_generation()` 함수는 **시뮬레이션** 중입니다.

### 4.2 실제 로직 연결

```python
# backend/generation_api.py의 run_qa_generation() 함수를 수정

from main import generate_qa as actual_generate_qa  # 기존 함수 import

def run_qa_generation(
    job_id: str,
    model: str,
    lang: str,
    samples: int,
    qa_per_doc: Optional[int],
    prompt_version: str
) -> None:
    """Background task: Run actual QA generation"""
    try:
        job_manager.update_job(
            job_id,
            status=JobStatus.RUNNING,
            progress=5,
            message="Initializing generation pipeline..."
        )

        # 실제 main.py 함수 호출
        result = actual_generate_qa(
            model=model,
            lang=lang,
            samples=samples,
            qa_per_doc=qa_per_doc,
            prompt_version=prompt_version,
            job_id=job_id,  # Progress callback 전달
            progress_callback=lambda p, msg: job_manager.update_job(
                job_id, progress=p, message=msg
            )
        )

        job_manager.update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress=100,
            message="Generation completed successfully",
            result_file=result.get('filename')
        )

    except Exception as e:
        job_manager.update_job(
            job_id,
            status=JobStatus.FAILED,
            error=str(e)
        )
```

---

## 🚀 Step 5: 배포 체크리스트

### Backend
- [ ] `generation_api.py` 내용을 `main.py`에 통합
- [ ] CORS origins 설정 확인
- [ ] 로깅 설정 확인
- [ ] 결과 디렉토리 생성 확인

### Frontend
- [ ] `QAGenerationPanel.tsx` 업데이트
- [ ] `.env` 파일에 VITE_API_URL 설정
- [ ] 타입 정의 추가
- [ ] API 호출 테스트

### 통합
- [ ] Backend와 Frontend 모두 실행
- [ ] API 호출 흐름 테스트
- [ ] 에러 처리 확인
- [ ] 로그 확인

---

## 📊 API 명세

### POST /api/generate

**Request**:
```json
{
  "model": "flashlite|flash|gpt-5.1|gpt-4o",
  "lang": "ko|en",
  "samples": 1-50,
  "qa_per_doc": null,
  "prompt_version": "v1|v2"
}
```

**Response**:
```json
{
  "success": true,
  "job_id": "gen_20260311_153000_123456",
  "message": "Generation started",
  "config": { ... },
  "timestamp": "2026-03-11T15:30:00.123456"
}
```

### GET /api/generate/{job_id}/status

**Response**:
```json
{
  "success": true,
  "job_id": "gen_20260311_153000_123456",
  "status": "running",
  "progress": 45,
  "message": "Generating QA pairs...",
  "error": null,
  "result_file": "qa_flashlite_ko_v2_20260311_153045.json",
  "timestamp": "2026-03-11T15:30:00.123456",
  "config": { ... }
}
```

### GET /api/generate/jobs

**Parameters**:
- `status`: pending|running|completed|failed|cancelled (optional)
- `limit`: number (default: 100)

**Response**:
```json
{
  "success": true,
  "count": 5,
  "jobs": [
    {
      "job_id": "gen_20260311_153000_123456",
      "status": "completed",
      "progress": 100,
      "message": "Generation completed successfully",
      "result_file": "qa_flashlite_ko_v2_20260311_153045.json",
      "started_at": "2026-03-11T15:30:00.123456",
      "completed_at": "2026-03-11T15:32:30.654321"
    }
  ]
}
```

### DELETE /api/generate/{job_id}

**Response**:
```json
{
  "success": true,
  "job_id": "gen_20260311_153000_123456",
  "message": "Job cancelled"
}
```

---

## 🔍 문제 해결

### Frontend에서 API 연결 안 됨

```bash
# 1. Backend가 실행 중인지 확인
curl http://localhost:8000/health

# 2. CORS 설정 확인
# frontend/.env에 VITE_API_URL 설정되어 있는지 확인
# backend의 CORS_ORIGINS에 frontend URL이 포함되어 있는지 확인

# 3. 네트워크 탭에서 요청 확인
# Browser DevTools → Network → XHR/Fetch
```

### Generation이 진행되지 않음

```python
# backend/main.py에서 로그 레벨 확인
import logging
logging.basicConfig(level=logging.DEBUG)

# 그 다음 backend 재시작
```

### 결과 파일이 생성되지 않음

```bash
# 1. output 디렉토리 생성 확인
mkdir -p /home/jpjp92/devs/works/autoeval/output

# 2. 권한 확인
ls -la /home/jpjp92/devs/works/autoeval/ | grep output

# 3. 디스크 공간 확인
df -h /home/jpjp92/devs/works/autoeval/
```

---

## 📝 다음 단계

### Phase 2: 평가 파이프라인 연결
- [ ] Auto-evaluation API 구현
- [ ] Frontend에서 평가 자동 실행

### Phase 3: 실시간 업데이트로 업그레이드
- [ ] SSE (Server-Sent Events) 구현
- [ ] Polling → Push로 변경

### Phase 4: Job 큐 시스템
- [ ] Celery 또는 APScheduler 통합
- [ ] 대기열 관리
- [ ] 작업 우선순위
