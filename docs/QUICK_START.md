# 🚀 빠른 시작 가이드 (10분)

## 📍 현재 상황

```
✗ Frontend: Mock only (API 호출 안됨)
✗ Backend: /api/generate 미구현  
✓ API 구조: 정의되어 있음
✓ Main.py: 완전한 QA 생성 로직 ⭐ (Anthropic, Google, OpenAI 지원)
```

## 🎯 목표

**Main.py의 실제 QA 생성 로직 + Backend API + Frontend UI를 연결**

## 🔄 아키텍처 (3계층)

```
Layer 1: Frontend (React UI)
  └─ QAGenerationPanel.tsx
     
Layer 2: Backend API (FastAPI)
  └─ /api/generate → main.py 함수 호출
     
Layer 3: Actual Logic (Main.py) ⭐
  └─ generate_qa(item, model, lang) → 실제 LLM API 호출
```

---

## 💻 Step 1: Backend 통합 (main.py 연결) - 5분

### ✅ 준비 완료

`backend/generation_api.py`에 main.py 통합이 이미 구현되어 있습니다:

```python
# main.py에서 generate_qa() 함수 자동 import
from main import generate_qa as main_generate_qa

# 두 가지 모드로 자동 선택:
# • Real Mode: main.py로 실제 QA 생성 (API 키 있을 때)
# • Simulation Mode: 가짜 진행률 표시 (API 키 없거나 에러 시)
```

### 1-1. Backend main.py에 다음 추가

`backend/main.py` 상단:

```python
# imports 추가
import sys
from pathlib import Path
from fastapi import BackgroundTasks  # 추가!

# generation_api.py import
from generation_api import (
    JobManager,
    GenerateRequest,
    JobStatus,
    setup_generation_routes
)

# 다른 설정 이후, app 생성 후 다음 추가:
app = FastAPI(...)

# <<<< 여기 추가 >>>>
job_manager = JobManager()
setup_generation_routes(app)  # generation_api의 라우트 등록
```

### 1-2. 확인 (터미널에서)

```bash
cd /home/jpjp92/devs/works/autoeval
python -c "import sys; sys.path.insert(0, '.'); from main import generate_qa; print('✓ main.py import OK')"
```

**결과**: `✓ main.py import OK`

---

## 🎨 Step 2: Frontend 수정 (1분)

### ✅ 이미 준비됨!

`frontend/src/components/generation/QAGenerationPanel.improved.tsx`가 준비되어 있습니다.

### 2-1. 파일 교체

```bash
cd /home/jpjp92/devs/works/autoeval/frontend/src/components/generation

# 백업
cp QAGenerationPanel.tsx QAGenerationPanel.tsx.old

# 개선된 버전 적용
cp QAGenerationPanel.improved.tsx QAGenerationPanel.tsx
```

### 2-2. `.env` 파일 확인

```bash
cd /home/jpjp92/devs/works/autoeval/frontend

# 파일 확인
cat .env

# 없거나 VITE_API_URL이 없으면 추가
echo 'VITE_API_URL=http://localhost:8000' > .env
```

---

## ✅ Step 3: 테스트 (4분)

### 3-1. Backend 시작 (터미널 1)

```bash
cd /home/jpjp92/devs/works/autoeval
source .venv/bin/activate

cd backend
python -m uvicorn main:app --reload --port 8000
```

**확인**: 
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### 3-2. Frontend 시작 (터미널 2)

```bash
cd /home/jpjp92/devs/works/autoeval/frontend
npm run dev
```

**확인**:
```
VITE v6.2.0  ready in XXX ms
```

### 3-3. 브라우저 준비 (터미널 3)

```bash
# Health check
curl http://localhost:8000/health
# 결과: {"status":"healthy","timestamp":"..."}
```

### 3-4. UI에서 테스트 ⭐

1. **브라우저**: http://localhost:5173
2. **Tab 클릭**: "Data Generation"
3. **설정** (테스트용 작은 샘플):
   - 모델: `Gemini 3.1 Flash-Lite` (빠르고 저렴)
   - 언어: `한국어 (ko)`
   - 샘플: `2` (테스트용)
   - 프롬프트: `v2`
4. **버튼 클릭**: "생성 및 평가 시작"

### 3-5. 결과 확인 ✓✓✓

#### Backend 로그 (터미널 1)
```
[...] Starting generation: model=flashlite, lang=ko, samples=2
[...] Using real main.py logic
[...] Loaded 2 documents
[...] Generating QA for document 1/2: ktcom_3842
[...] Generating QA for document 2/2: ktcom_3843
[...] Saving results...
[...] Results saved to qa_flashlite_ko_v2_202603xx_xxxxxx.json
```

#### Browser UI (http://localhost:5173)
```
✓ Progress bar: 0% → 100%
✓ Terminal output: 실제 backend 로그 표시
✓ Message: "생성 완료!"
```

#### 파일시스템
```bash
ls -lh output/
qa_flashlite_ko_v2_202603xx_xxxxxx.json  ← 실제 파일 생성!

# 내용 확인
head -30 output/qa_flashlite_ko_v2_*.json
```

---

## 🔧 환경 설정 (선택사항 - API 키)

### 실제 LLM 호출 (Real Mode)

API 키를 설정하면 실제 LLM으로 QA가 생성됩니다:

```bash
# .env 파일에 추가
export ANTHROPIC_API_KEY=sk-ant-...      # Claude 사용 시
export GOOGLE_API_KEY=AIza...            # Gemini 사용 시
export OPENAI_API_KEY=sk-proj-...        # GPT 사용 시
```

### 키 없을 때 (Fallback Simulation)

```
main.py import 실패
  ↓
자동으로 simulation 모드 활성화
  ├─ 진행률만 시뮬레이션
  ├─ 가짜 QA 생성
  └─ 테스트는 정상 작동 ✓
```

---

## 📊 두 가지 모드의 결과 비교

### Real Mode (API 키 있음)

```
Terminal Output:
[...] Generating QA for document 1/2: ktcom_3842
[OK] Using Gemini 3.1 Flash-Lite API ← 실제 API 호출!
[...] Generated 8 QA pairs

output/qa_flashlite_ko_v2_202603xx_xxxxxx.json:
{
  "qa_list": [
    {
      "q": "KT의 고객지원 번호는?",           ← 실제 질문
      "a": "고객지원 번호는 1577-0010입니다",  ← 실제 답변
      "intent": "factoid",
      "answerable": true
    },
    ...
  ]
}
```

### Simulation Mode (API 키 없음)

```
Terminal Output:
[...] main.py import failed
[...] Using simulation mode for testing
[...] Generating QA pairs...

output/qa_flashlite_ko_v2_202603xx_xxxxxx.json:
{
  "qa_list": [
    {
      "q": "Sample question 1",           ← 테스트용
      "a": "Sample answer 1",             ← 테스트용
      "intent": "factoid",
      "answerable": true
    },
    ...
  ],
  "_note": "Simulation mode (main.py not available)"
}
```

---

## 🚀 작동 원리

### 3계층 데이터 흐름

```
1️⃣ Frontend (React)
   POST /api/generate {model: "flashlite", lang: "ko", samples: 2}
   
2️⃣ Backend (FastAPI)
   ├─ Job 생성: job_id = "gen_20260311_143022_123456"
   ├─ Background task 시작
   └─ 즉시 job_id 반환
   
3️⃣ Background Task (Python)
   ├─ 데이터 로드: ref/data/data_2026-03-06_normalized.json
   ├─ 각 문서마다 main.py의 generate_qa() 호출
   │  ├─ 실제: Gemini/GPT/Claude API 호출 (Real mode)
   │  └─ 시뮬레이션: 가짜 QA 생성 (Fallback mode)
   ├─ Progress 업데이트
   └─ 결과 저장: output/qa_*.json
   
4️⃣ Frontend (Polling)
   GET /api/generate/gen_20260311_143022_123456/status
   ├─ 매초마다 상태 조회
   ├─ Progress 업데이트
   ├─ 메시지 표시
   └─ 완료 시 result_file 표시
```

---

## ⚡ 체크리스트

### Before Starting
- [ ] Backend 폴더: `backend/generation_api.py` 확인 ✓
- [ ] Frontend 폴더: `QAGenerationPanel.improved.tsx` 확인 ✓
- [ ] Data 폴더: `ref/data/data_2026-03-06_normalized.json` 확인

### Running
- [ ] Backend 시작: `python -m uvicorn main:app --reload`
- [ ] Frontend 시작: `npm run dev`
- [ ] Browser 열기: http://localhost:5173

### Testing
- [ ] Health check: `curl http://localhost:8000/health` ✓
- [ ] UI에서 생성 버튼 클릭
- [ ] Progress bar 업데이트 확인 ✓
- [ ] Terminal output 보임 ✓
- [ ] output/qa_*.json 파일 생성 확인 ✓

---

## 📝 설정 파일 위치

```
Project Root
├── main.py                              ← 실제 QA 생성 로직
├── ref/data/data_2026-03-06_normalized.json   ← 입력 데이터
├── output/                              ← 생성된 QA 파일들
│
├── backend/
│   ├── main.py            ← FastAPI 서버 (수정 필요)
│   └── generation_api.py   ← 생성 로직 (준비됨 ✓)
│
└── frontend/
    ├── .env               ← VITE_API_URL 설정
    └── src/components/generation/
        └── QAGenerationPanel.tsx  ← 교체됨 ✓
```

---

## 🆘 문제 해결

### "main.py import failed"
```
→ API 키가 없거나 환경이 맞지 않음
→ Fallback simulation 모드 자동 활성화
→ 테스트는 정상 작동 ✓
```

### "job not found"
```bash
# Backend 로그 확인
tail -20 backend/logs/*.log

# Backend 재시작
Ctrl+C
python -m uvicorn main:app --reload
```

### "Cannot connect to API"
```bash
# Backend 실행 중인지 확인
curl http://localhost:8000/health

# Port 이미 사용 중?
lsof -i :8000

# 다른 포트로 시작
python -m uvicorn main:app --port 8001
# frontend/.env 수정: VITE_API_URL=http://localhost:8001
```

### "데이터 파일 없음"
```bash
ls -la ref/data/
# 없으면 다른 파일 사용
python main.py --data-file ref/data/other_file.json --samples 2
```

---

## 📌 다음 단계

### Phase 2: 평가 파이프라인
```python
POST /api/evaluate
  └─ qa_quality_evaluator.py 호출
```

### Phase 3: 실시간 스트리밍 (향후)
```
Polling (현재) → SSE (나중)
  1초마다 상태 조회 → 실시간 푸시
```

---

## 💡 핵심 포인트

```
✓ Main.py: 완전한 QA 생성 로직 (이미 있음!)
✓ Backend: main.py 함수 호출 (generation_api.py 준비됨)
✓ Frontend: API 호출 + UI (QAGenerationPanel.improved.tsx 준비됨)
✓ 통합: main.py → Backend → Frontend (3계층 연결)

결과:
  CLI: python main.py (기존대로)
  API: Frontend → Backend → main.py (새로 추가)
  
  같은 로직, 두 가지 인터페이스 ✓
```

```bash
cd /home/jpjp92/devs/works/autoeval/frontend

# .env 파일 없으면 생성
echo 'VITE_API_URL=http://localhost:8000' > .env
```

---

## ✅ Step 3: 테스트 (2분)

### 3-1. Backend 시작 (터미널 1)
```bash
cd /home/jpjp92/devs/works/autoeval/backend
python -m uvicorn main:app --reload --port 8000
```

**확인**: `Uvicorn running on http://127.0.0.1:8000`

### 3-2. Frontend 시작 (터미널 2)
```bash
cd /home/jpjp92/devs/works/autoeval/frontend
npm run dev
```

**확인**: `VITE v6.2.0  ready in 524 ms`

### 3-3. 브라우저 테스트 (터미널 3)

```bash
# Health check
curl http://localhost:8000/health

# 출력: {"status":"healthy","timestamp":"2026-03-11T15:30:00..."}
```

### 3-4. UI 테스트

1. **브라우저 열기**: http://localhost:5173
2. **"Data Generation" 탭 클릭**
3. **"생성 및 평가 시작" 버튼 클릭**
4. **Terminal output에 실제 로그 표시되는지 확인** ✓

---

## 🔍 결과 확인

생성 완료 후:
```bash
# 결과 파일 확인
ls -lh /home/jpjp92/devs/works/autoeval/output/

# 예상 결과:
# qa_flashlite_ko_v2_20260311_143022.json
# qa_gpt-5.1_ko_v2_20260311_143045.json
# ...
```

---

## 🆘 문제 해결

### "job not found" 오류
→ Backend의 `/api/generate/{job_id}/status` 응답 오류
→ Backend 로그 확인

### "Cannot connect to server"
→ Backend가 실행 중인지 확인
→ `curl http://localhost:8000/health` 실행

### API 호출이 안 됨
→ Framework 개발자 도구 → Network 탭 확인
→ `.env` 파일에 VITE_API_URL 설정 확인

---

## 📊 다음 단계

| 우선순위 | 항목 | 시간 |
|---------|-----|------|
| 🔴 필수 | 자동 평가 API 연결 | 30분 |
| 🟡 권장 | SSE로 실시간 업그레이드 | 1시간 |
| 🟢 선택 | Job queue 시스템 (Celery) | 2시간 |

---

## 📝 참고 파일

- **상세 가이드**: [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)
- **전체 분석**: [FRONTEND_REVIEW.md](./FRONTEND_REVIEW.md)
- **Backend 구현**: [backend/generation_api.py](./backend/generation_api.py)
- **Frontend 구현**: [frontend/src/components/generation/QAGenerationPanel.improved.tsx](./frontend/src/components/generation/QAGenerationPanel.improved.tsx)
