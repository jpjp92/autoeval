# Frontend 구조 분석 및 개선 방안

## 📋 현재 Frontend 구조

### 폴더 구조
```
frontend/
├── public/
├── src/
│   ├── components/
│   │   ├── agents/          (Models table)
│   │   ├── analytics/       (Analytics dashboard)
│   │   ├── dashboard/       (Main dashboard - DashboardOverview)
│   │   ├── evaluation/      (QA Evaluation - QAEvaluationDashboard)
│   │   ├── generation/      (QA Generation - QAGenerationPanel)  ← Main Focus
│   │   ├── layout/          (Sidebar, Header)
│   │   ├── playground/      (Chat playground)
│   │   └── settings/        (Settings panel)
│   ├── lib/
│   │   ├── api.ts           (Backend API client)
│   │   ├── exportUtils.ts   (Export utilities)
│   │   └── utils.ts         (UI utilities)
│   ├── App.tsx              (Main router)
│   ├── main.tsx
│   └── index.css
├── package.json             (React 19, Vite, TailwindCSS)
├── vite.config.ts
└── tsconfig.json
```

### Stack
- **Framework**: React 19 + TypeScript
- **Build**: Vite
- **Styling**: TailwindCSS + lucide-react icons
- **State Management**: Local useState (No Redux/Zustand)
- **HTTP**: Fetch API
- **Chart**: Recharts

---

## 🚨 Data Generation (QAGenerationPanel) 문제점

### 1. **Backend 연결 미흡**
```tsx
// 현재: Mock 상태만 구현
const [progress, setProgress] = useState(0);
const [phase, setPhase] = useState<"idle" | "generating" | "evaluating" | "complete">("idle");

const handleStart = () => {
  setIsGenerating(true);
  setProgress(0);
  setPhase("generating");
  
  // 진짜 backend API 호출 없음 - fake 애니메이션만 있음
  const interval = setInterval(() => {
    setProgress((prev) => prev + 5); // 가짜 진행률
  }, 150);
};
```

### 2. **실제 API 호출 부재**
```typescript
// api.ts에 정의된 함수
export async function generateQA(request: GenerateRequest): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return await response.json();
}

// 근데 QAGenerationPanel에서는 호출 안됨!
```

### 3. **Backend의 /api/generate 미구현**
```python
@app.post("/api/generate")
def generate_qa(request: GenerateRequest):
    """Start QA generation"""
    try:
        logger.info(f"Generation request: {request.model_dump()}")
        
        # TODO: Integrate with main.py's generate_qa function  ← 구현 필요
        
        return {
            "success": True,
            "message": "Generation started",
            "job_id": f"job_{datetime.now().timestamp()}",
        }
```

### 4. **Progress Tracking 부재**
- 실시간 진행 상황 추적 불가능
- 에러 발생 시 사용자 피드백 없음
- 취소 기능 없음

### 5. **State 관리 문제**
- UI State와 실제 작업 State가 분리되어 있음
- 렌더링 재시작 시 진행 상황 손실됨
- 여러 탭 전환 시 작업 상태 추적 불가

---

## 💡 개선 방안

### Phase 1: Backend 통합 (필수)

#### 1-1. Backend의 /api/generate 구현
```python
# backend/main.py
from subprocess import Popen, PIPE
from pathlib import Path
import threading
import time

# Job 상태 추적 (in-memory, 실제로는 DB 사용 권장)
active_jobs = {}

@app.post("/api/generate")
async def generate_qa(request: GenerateRequest):
    """
    Start QA generation with real backend integration
    Returns job_id for progress tracking
    """
    try:
        job_id = f"job_{datetime.now().timestamp()}"
        
        # Background에서 실행 (thread 또는 celery)
        def run_generation():
            try:
                # main.py 호출
                result = generate_qa_data(
                    model=request.model,
                    lang=request.lang,
                    samples=request.samples,
                    qa_per_doc=request.qa_per_doc,
                    prompt_version=request.prompt_version,
                )
                
                active_jobs[job_id] = {
                    'status': 'completed',
                    'result': result,
                    'timestamp': datetime.now().isoformat()
                }
            except Exception as e:
                active_jobs[job_id] = {
                    'status': 'failed',
                    'error': str(e),
                    'timestamp': datetime.now().isoformat()
                }
        
        # 비동기 실행
        thread = threading.Thread(target=run_generation, daemon=True)
        thread.start()
        
        active_jobs[job_id] = {
            'status': 'pending',
            'request': request.model_dump(),
            'timestamp': datetime.now().isoformat()
        }
        
        return {
            "success": True,
            "job_id": job_id,
            "message": "Generation started",
            "config": request.model_dump()
        }
```

#### 1-2. Progress Tracking 엔드포인트 추가
```python
@app.get("/api/generate/{job_id}/status")
async def get_generation_status(job_id: str):
    """
    Get current generation job status
    Returns: pending, running, completed, or failed
    """
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "success": True,
        "job_id": job_id,
        "status": active_jobs[job_id]['status'],
        "result": active_jobs[job_id].get('result'),
        "error": active_jobs[job_id].get('error'),
        "timestamp": active_jobs[job_id].get('timestamp')
    }
```

### Phase 2: Frontend 연결 (필수)

#### 2-1. QAGenerationPanel에서 실제 API 호출
```tsx
// src/components/generation/QAGenerationPanel.tsx
import { generateQA } from "@/src/lib/api";

const [generationJobId, setGenerationJobId] = useState<string | null>(null);

const handleStart = async () => {
  setIsGenerating(true);
  setProgress(0);
  setPhase("generating");
  
  const model = (document.querySelector('select[name="model"]') as HTMLSelectElement)?.value || 'flashlite';
  const lang = (document.querySelector('select[name="lang"]') as HTMLSelectElement)?.value || 'ko';
  const samples = parseInt((document.querySelector('input[name="samples"]') as HTMLInputElement)?.value || '8');
  
  try {
    const response = await generateQA({
      model,
      lang,
      samples,
      prompt_version: 'v2'
    });
    
    if (response.success && response.data?.job_id) {
      setGenerationJobId(response.data.job_id);
      
      // Polling으로 진행상황 추적
      const pollInterval = setInterval(async () => {
        const statusResponse = await fetch(
          `${API_BASE}/api/generate/${response.data.job_id}/status`
        );
        const statusData = await statusResponse.json();
        
        if (statusData.status === 'completed') {
          setProgress(100);
          setPhase("complete");
          setIsGenerating(false);
          clearInterval(pollInterval);
        } else if (statusData.status === 'failed') {
          setPhase("complete");
          setIsGenerating(false);
          clearInterval(pollInterval);
          alert(`Generation failed: ${statusData.error}`);
        }
      }, 1000); // 1초마다 확인
      
    }
  } catch (error) {
    console.error('Generation failed:', error);
    setPhase("complete");
    setIsGenerating(false);
  }
};
```

#### 2-2. Form Values 제대로 수집하기
```tsx
// 현재: select/input으로 직접 접근 (안 좋음)
// 개선: useState로 관리

const [formValues, setFormValues] = useState({
  model: "flashlite",
  lang: "ko",
  samples: 8,
  promptVersion: "v2"
});

<select 
  value={formValues.model}
  onChange={(e) => setFormValues({...formValues, model: e.target.value})}
  className="w-full p-2.5..."
>
  <option>GPT-5.1</option>
  <option>GPT-4o</option>
</select>
```

### Phase 3: 고급 기능 (선택)

#### 3-1. SSE (Server-Sent Events) 스트리밍
```python
# Backend - real-time progress streaming
from fastapi.responses import StreamingResponse

@app.get("/api/generate/{job_id}/stream")
async def generate_stream(job_id: str):
    async def event_generator():
        while True:
            if job_id in active_jobs:
                yield f"data: {json.dumps(active_jobs[job_id])}\n\n"
                if active_jobs[job_id]['status'] in ['completed', 'failed']:
                    break
            await asyncio.sleep(1)
    
    return StreamingResponse(
        event_generator(), 
        media_type="text/event-stream"
    )
```

```tsx
// Frontend - consume SSE stream
const handleStartWithSSE = async () => {
  const eventSource = new EventSource(`${API_BASE}/api/generate/${jobId}/stream`);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    setProgress(data.progress || 0);
    setPhase(data.status);
  };
  
  eventSource.onerror = () => {
    eventSource.close();
  };
};
```

#### 3-2. Job Queue (Celery 또는 APScheduler)
```python
# 장기 실행 작업 관리
from celery import Celery

celery_app = Celery('autoeval', broker='redis://localhost:6379')

@celery_app.task
def generate_qa_task(model, lang, samples):
    return generate_qa_data(model, lang, samples)

@app.post("/api/generate")
async def generate_qa(request: GenerateRequest):
    task = generate_qa_task.delay(request.model, request.lang, request.samples)
    return {"job_id": task.id, "status": "queued"}
```

#### 3-3. Global State Management (Zustand/Redux)
```typescript
// Store로 상태 중앙화 (탭 전환 시 상태 보존)
import { create } from 'zustand';

type GenerationState = {
  jobId: string | null;
  status: 'idle' | 'generating' | 'evaluating' | 'complete';
  progress: number;
  error: string | null;
  setJobId: (id: string) => void;
  setStatus: (status) => void;
};

const useGenerationStore = create<GenerationState>((set) => ({
  jobId: null,
  status: 'idle',
  progress: 0,
  error: null,
  setJobId: (id) => set({ jobId: id }),
  setStatus: (status) => set({ status }),
}));
```

---

## 🎯 우선순위별 구현 순서

### 1순위 (필수)
- [ ] Backend `/api/generate` 구현 (실제 main.py 호출)
- [ ] `/api/generate/{job_id}/status` 엔드포인트 추가
- [ ] Frontend에서 실제 API 호출로 변경
- [ ] Polling으로 진행상황 추적

### 2순위 (권장)
- [ ] Form validation 추가
- [ ] Error handling 개선
- [ ] Cancel job 기능
- [ ] Job history 관리

### 3순위 (선택)
- [ ] SSE streaming으로 업그레이드 (polling → push)
- [ ] Job queue 도입 (Celery)
- [ ] Global state management 도입
- [ ] Real-time log streaming

---

## 📊 Architecture 개선 제안

```
Current (문제점)
Frontend          Backend
  │                  │
  └─ Mock UI ──┘  ┌─ API (미구현)
                   ├─ main.py (미연결)
                   └─ evaluator.py (미연결)

Improved (권장)
Frontend                 Backend              Worker
  │                        │                    │
  ├─ Real UI ──────────┬─ FastAPI ──────────────┤
  │                    │  ├─ /api/generate     │
  │                    │  ├─ /api/status       │ (Thread/Celery)
  ├─ Store ◄───────────┤  └─ /api/stream       │
  │ (Zustand)          │                        │
  └─ SSE Client        └─ Job Manager          └─ Worker Process
                          └─ DB (Redis/SQLite)    (main.py execution)
```

---

## 📝 구현 체크리스트

### Backend
- [ ] `/api/config` - 설정 조회 (hierarchy, models)
- [ ] `/api/generate` - 생성 시작 (job_id 반환)
- [ ] `/api/generate/{job_id}/status` - 상태 조회
- [ ] `/api/generate/{job_id}/logs` - 실시간 로그 (선택)
- [ ] `/api/jobs` - 작업 목록 조회

### Frontend
- [ ] QAGenerationPanel - 실제 API 호출 연결
- [ ] Form state 관리 (useState)
- [ ] Progress polling 구현
- [ ] Error boundary 추가
- [ ] Loading/error UI 구현
- [ ] Terminal output 실제 로그 표시

### Integration
- [ ] Backend와 Frontend 통신 테스트
- [ ] CORS 설정 확인
- [ ] Environment variable 확인 (VITE_API_URL)
