# Frontend Architecture 비교

## 📊 현재 vs 개선안

### 현재 상태 (Mock)

```
┌─────────────────────────────────────────────────────────────┐
│                      QAGenerationPanel                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ UI State Management (Mock)                           │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ const [progress, setProgress] = useState(0);         │   │
│  │ const [phase, setPhase] = useState("idle");          │   │
│  │                                                       │   │
│  │ const handleStart = () => {                          │   │
│  │   // Fake animation only!                            │   │
│  │   setProgress(prev => prev + 5); // Mock            │   │
│  │ }                                                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ❌ No Backend API Call                                      │
│  ❌ No Real Processing                                       │
│  ❌ No Error Handling                                        │
│  ✓ UI Only (React state)                                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘

     Frontend                         Backend
        (React)                     (FastAPI)
         │                              │
         └──────────── No Connection ───┘
                    (Mock only)
```

### 개선안 (Real Integration)

```
┌──────────────────────────────────────────────────────────────────┐
│                      QAGenerationPanel                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Form State Management                                       │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │ const [formValues, setFormValues] = useState({             │ │
│  │   model: "flashlite",    ← User input                      │ │
│  │   lang: "ko",            ← User input                      │ │
│  │   samples: 8,            ← User input                      │ │
│  │   autoEvaluate: true,    ← User input                      │ │
│  │ });                                                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Processing State Management                                 │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │ const [jobId, setJobId] = useState<string | null>(null);   │ │
│  │ const [isGenerating, setIsGenerating] = useState(false);   │ │
│  │ const [progress, setProgress] = useState(0);               │ │
│  │ const [statusMessage, setStatusMessage] = useState("");    │ │
│  │ const [error, setError] = useState<string | null>(null);   │ │
│  │ const [resultFile, setResultFile] = useState<string | null>│ │
│  │                                                             │ │
│  │ // Polling for real-time updates                           │ │
│  │ useEffect(() => {                                          │ │
│  │   if (!isGenerating || !jobId) return;                     │ │
│  │                                                             │ │
│  │   const pollInterval = setInterval(async () => {           │ │
│  │     const response = await fetch(                          │ │
│  │       `/api/generate/${jobId}/status`  ← Real API call    │ │
│  │     );                                                      │ │
│  │     const data = await response.json();                    │ │
│  │     setProgress(data.progress);        ← Update progress  │ │
│  │     setStatusMessage(data.message);    ← Update message   │ │
│  │   }, 1000);                                                │ │
│  │                                                             │ │
│  │   return () => clearInterval(pollInterval);               │ │
│  │ }, [isGenerating, jobId]);                                 │ │
│  │                                                             │ │
│  │ const handleStart = async () => {                          │ │
│  │   const response = await generateQA({  ← Real API call    │ │
│  │     model: formValues.model,                               │ │
│  │     lang: formValues.lang,                                 │ │
│  │     samples: formValues.samples,                           │ │
│  │   });                                                       │ │
│  │   setJobId(response.data.job_id);     ← Start polling     │ │
│  │ };                                                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ✓ Form State → User Control                                     │
│  ✓ Processing State → Backend Sync (Polling)                     │
│  ✓ Real Backend API Calls                                        │
│  ✓ Error Handling                                                │
│  ✓ Real-time Progress Updates                                    │
│  ✓ Result File Tracking                                          │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
                         │
                  generateQA()
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        ↓                                 ↓
  POST /api/generate            GET /api/generate/{job_id}/status
  (Start Job)                   (Poll for Progress)
        │                                 │
        └─────────────┬───────────────────┘
                      │
                      ↓
    ┌─────────────────────────────────────────┐
    │          FastAPI Backend                │
    ├─────────────────────────────────────────┤
    │                                         │
    │  JobManager (In-Memory Job Tracking)   │
    │  ├─ job_id → status, progress, msg    │
    │  └─ Thread-safe concurrent access      │
    │                                         │
    │  Background Task (Thread)              │
    │  ├─ Load hierarchy (10% → progress)   │
    │  ├─ Parse documents (20%)              │
    │  ├─ Generate QA pairs (40-80%)         │
    │  ├─ Save results (95%)                 │
    │  └─ Update job status → COMPLETED      │
    │                                         │
    │  REST Endpoints                        │
    │  ├─ POST /api/generate                 │
    │  ├─ GET /api/generate/{job_id}/status  │
    │  ├─ GET /api/generate/jobs             │
    │  └─ DELETE /api/generate/{job_id}      │
    │                                         │
    │  File System                           │
    │  └─ output/qa_*.json (Results)         │
    │                                         │
    └─────────────────────────────────────────┘
```

---

## 🔄 Data Flow

### 현재 (Mock)

```
User Click
    ↓
handleStart()
    ↓
setProgress(0)
    ↓
Loop: setProgress += 5 (Fake)
    ↓
Terminal Output (Mock)
    ↓
Done (No real data)
```

### 개선안 (Real)

```
User Input (model, lang, samples)
    ↓
User Click: "시작"
    ↓
handleStart()
    ├── 1. POST /api/generate → Backend
    │   └── Returns: job_id
    │
    ├── 2. setJobId(job_id)
    │   └── Triggers useEffect polling
    │
    ├── 3. Polling Loop (every 1000ms)
    │   ├── GET /api/generate/{job_id}/status
    │   ├── Response: {status, progress, message, error, result_file}
    │   ├── setProgress(response.progress)
    │   ├── setStatusMessage(response.message)
    │   └── setLogs([...logs, response.message])
    │
    └── 4. Backend Processing
        ├── Thread: run_qa_generation()
        │   ├── Load hierarchy: progress=10%
        │   ├── Parse documents: progress=20%
        │   ├── Generate QA: progress=40-80%
        │   ├── Save results: progress=95%
        │   └── Final: progress=100%, status=COMPLETED
        │
        └── Update JobManager
            └── Get by job_id → return current status

Terminal Output: Real logs from backend
    ↓
Results: Real JSON file in output/
```

---

## 📈 상태 흐름

### Frontend State Transitions

```
IDLE
  ↓
  └──[Click "시작"]─→ GENERATING
                       ├─→ [progress: 0→100]
                       ├─→ [status updates]
                       ├─→ [logs accumulating]
                       │
                       └──[Job Complete]─→ EVALUATING (if autoEvaluate=true)
                                            │
                                            └──[Eval done]─→ COMPLETE
                       
                       └──[Error]─→ COMPLETE (with error)
                       
                       └──[Cancel]─→ CANCELLED
```

### Backend State Transitions

```
PENDING
  └──[Background task started]─→ RUNNING
                                  ├─→ progress: 10%
                                  ├─→ progress: 20%
                                  ├─→ ...
                                  ├─→ progress: 100%
                                  │
                                  └──[Success]─→ COMPLETED
                                           ├─ result_file = "qa_*.json"
                                           └─ error = null
                                  
                                  └──[Exception]─→ FAILED
                                           ├─ result_file = null
                                           └─ error = "Error message"
```

---

## 🔗 API Contract

### Request → Response

**Frontend → Backend**
```
POST /api/generate
Headers:
  Content-Type: application/json
Body:
{
  "model": "flashlite",
  "lang": "ko", 
  "samples": 8,
  "prompt_version": "v2"
}

Response:
{
  "success": true,
  "job_id": "gen_20260311_153000_123456",
  "message": "Generation started",
  "config": { ... },
  "timestamp": "2026-03-11T15:30:00..."
}
```

**Frontend ← Backend (Polling)**
```
GET /api/generate/gen_20260311_153000_123456/status

Response:
{
  "success": true,
  "job_id": "gen_20260311_153000_123456",
  "status": "running",           ← Job status
  "progress": 45,                ← Frontend updates UI with this
  "message": "Generating QA pairs...",
  "error": null,
  "result_file": "qa_flashlite_ko_v2_20260311_143022.json",
  "timestamp": "2026-03-11T15:30:00...",
  "config": { ... }
}
```

---

## 💾 State Comparison

| 항목 | 현재 | 개선안 |
|------|------|--------|
| **Form State** | 없음 (하드코드) | ✓ useState 관리 |
| **Backend Communication** | ❌ 없음 | ✓ API 호출 |
| **Job Tracking** | ❌ 없음 | ✓ job_id 추적 |
| **Progress Tracking** | Mock (자체 증가) | ✓ Backend에서 수신 |
| **Error Handling** | ❌ 없음 | ✓ error state |
| **Real-time Update** | ❌ 없음 | ✓ Polling (1초) |
| **결과 파일** | ❌ Mock 경로 | ✓ 실제 파일 이름 |
| **Terminal Logs** | Mock 메시지 | ✓ 실제 backend 로그 |
| **취소 기능** | ❌ 없음 | ✓ 구현됨 |
| **Auto-Evaluate** | UI만 있음 | (다음 단계) |

---

## 🎯 구현 난이도

```
현재 (Mock):
  - React state 관리만 필요
  - UI 렌더링만 필요
  - 실제 기능 없음
  - 간단하지만 무의미

개선안 (Real Integration):
  - Form state 관리 중
  - API 호출 로직 중
  - Background 작업 추적 중
  - Error handling 중
  - 더 복잡하지만 실용적
  
  난이도: ⭐⭐⭐☆☆ (적당)
  시간: 5분 (Quick Start) ~ 2시간 (Full Implementation)
```

---

## 📋 구현 체크리스트

### Backend (main.py 수정)
- [ ] JobStatus Enum 추가
- [ ] GenerationJob dataclass 추가
- [ ] JobManager 클래스 추가
- [ ] run_qa_generation() 함수 추가
- [ ] @app.post("/api/generate") 구현
- [ ] @app.get("/api/generate/{job_id}/status") 구현
- [ ] BackgroundTasks import 추가

### Frontend (QAGenerationPanel.tsx 수정)
- [ ] formValues state 추가
- [ ] isGenerating, jobId state 추가
- [ ] progress, statusMessage, error state 추가
- [ ] useEffect로 polling 로직 추가
- [ ] handleStart() 함수 수정 (실제 API 호출)
- [ ] 폼 입력 필드 연결
- [ ] 에러 UI 추가
- [ ] 취소 버튼 추가

### 통합 테스트
- [ ] Backend API 응답 확인
- [ ] Frontend에서 API 호출 확인
- [ ] 진행률 업데이트 확인
- [ ] 완료 후 파일 생성 확인
- [ ] 에러 처리 확인
