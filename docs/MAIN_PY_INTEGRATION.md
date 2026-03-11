# 실제 QA 생성 로직 (main.py) Backend 통합 분석

## 📊 현재 구조

### 레이어 1: Frontend (React UI)
```
QAGenerationPanel
  └─ Mock 애니메이션만 있음 (실제 기능 없음)
```

### 레이어 2: Backend API (FastAPI)
```
backend/main.py
  ├─ GET /api/results      ✓ 구현됨
  ├─ GET /api/status       ✓ 구현됨
  ├─ POST /api/generate    ✗ TODO (미구현)
  └─ POST /api/evaluate    ✗ TODO (미구현)
```

### 레이어 3: 실제 생성 로직 ⭐ (이미 구현됨!)
```
main.py (루트)
  ├─ generate_qa(item, model, lang, version)
  │   ├─ Anthropic API 호출
  │   ├─ Google Gemini API 호출
  │   └─ OpenAI API 호출
  │
  ├─ generate_qa_anthropic()  ✓
  ├─ generate_qa_google()     ✓
  ├─ generate_qa_openai()     ✓
  │
  └─ main()
      ├─ 데이터 로드 (ref/data/data_2026-03-06_normalized.json)
      ├─ QA 생성 (병렬)
      ├─ 토큰/비용 계산
      └─ 결과 JSON 저장 (output/)
```

---

## 🎯 통합 방법 (3가지 옵션)

### 옵션 1️⃣: Main.py 함수 직접 호출 (권장 ⭐)

**장점**: 최소한의 코드 변경, 재사용
**단점**: main.py를 모듈로 만들어야 함

```python
# backend/main.py

# 루트 main.py에서 함수 import
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import (
    generate_qa,
    MODEL_CONFIG,
    SYSTEM_PROMPT_KO_V2,
    SYSTEM_PROMPT_EN_V2,
    USER_TEMPLATE_KO_V2,
    USER_TEMPLATE_EN_V2,
)

@app.post("/api/generate")
async def generate_qa_endpoint(
    request: GenerateRequest,
    background_tasks: BackgroundTasks
) -> dict:
    """Start QA generation using main.py logic"""
    
    job_id = f"gen_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
    job_manager.create_job(job_id, request.model_dump())
    
    def run_generation():
        try:
            # 데이터 로드
            data_file = "ref/data/data_2026-03-06_normalized.json"
            with open(data_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            items = data if isinstance(data, list) else data.get("documents", [])
            items = items[:request.samples]
            
            # QA 생성
            results = []
            for i, item in enumerate(items, 1):
                # 실제 main.py의 generate_qa() 호출!
                result = generate_qa(
                    item,
                    request.model,
                    request.lang,
                    request.prompt_version
                )
                results.append(result)
                
                # 진행률 업데이트
                progress = int((i / len(items)) * 100)
                job_manager.update_job(
                    job_id,
                    progress=progress,
                    message=f"Generating QA {i}/{len(items)}..."
                )
            
            # 결과 저장
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"qa_{request.model}_{request.lang}_{request.prompt_version}_{timestamp}.json"
            filepath = Path("output") / filename
            
            output_data = {
                "config": {
                    "model": request.model,
                    "lang": request.lang,
                    "prompt_version": request.prompt_version,
                    "samples": len(items),
                    "timestamp": timestamp,
                },
                "statistics": {
                    "total_docs": len(items),
                    "total_qa": sum(len(r.get("qa_list", [])) for r in results),
                },
                "results": results,
            }
            
            Path("output").mkdir(exist_ok=True)
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, ensure_ascii=False, indent=2)
            
            job_manager.update_job(
                job_id,
                status=JobStatus.COMPLETED,
                progress=100,
                message="Generation completed successfully",
                result_file=filename
            )
            
        except Exception as e:
            job_manager.update_job(
                job_id,
                status=JobStatus.FAILED,
                error=str(e)
            )
    
    background_tasks.add_task(run_generation)
    
    return {
        "success": True,
        "job_id": job_id,
        "message": "Generation started",
        "config": request.model_dump(),
    }
```

### 옵션 2️⃣: Subprocess로 main.py 실행

**장점**: 완전 분리, 프로세스 격리
**단점**: 프로세스 오버헤드, 실시간 진행률 어려움

```python
import subprocess
import json

def run_generation():
    try:
        # main.py 실행
        result = subprocess.run(
            [
                "python",
                "main.py",
                "--model", request.model,
                "--lang", request.lang,
                "--samples", str(request.samples),
                "--prompt-version", request.prompt_version,
                "--output-dir", "output",
            ],
            capture_output=True,
            text=True,
            timeout=3600,  # 1시간 timeout
        )
        
        if result.returncode == 0:
            # 파일 찾기
            files = list(Path("output").glob("qa_*.json"))
            if files:
                filename = files[-1].name  # 가장 최신 파일
                job_manager.update_job(
                    job_id,
                    status=JobStatus.COMPLETED,
                    result_file=filename
                )
        else:
            job_manager.update_job(
                job_id,
                status=JobStatus.FAILED,
                error=result.stderr
            )
    except Exception as e:
        job_manager.update_job(
            job_id,
            status=JobStatus.FAILED,
            error=str(e)
        )

background_tasks.add_task(run_generation)
```

### 옵션 3️⃣: Main.py를 모듈화 + Backend 통합

**장점**: 최선의 아키텍처
**단점**: main.py 리팩토링 필요

```
current structure:
main.py (스크립트)
  ├─ 함수 정의
  └─ if __name__ == "__main__": main()

desired structure:
main.py (모듈)
  ├─ generate_qa() 함수
  ├─ GenerationPipeline 클래스
  └─ progress_callback 지원

backend/generation_service.py
  └─ GenerationService (main.py 래퍼)
      ├─ run_generation(options, progress_callback)
      └─ track_progress()
```

---

## 📝 상세 구현 (옵션 1: 직접 호출)

### Step 1: main.py를 폴더로 이동

```bash
# 스크립트 → 모듈로 변환
mkdir -p qa_generation
mv main.py qa_generation/generator.py
mv qa_generation/generator.py qa_generation/

# __init__.py 추가
echo "from .generator import generate_qa, MODEL_CONFIG" > qa_generation/__init__.py
```

### Step 2: Backend에서 import

```python
# backend/main.py
import sys
from pathlib import Path

# 루트 모듈 import
sys.path.insert(0, str(Path(__file__).parent.parent))
from qa_generation import generate_qa
```

### Step 3: Background 작업 실행

```python
@app.post("/api/generate")
async def start_generation(
    request: GenerateRequest,
    background_tasks: BackgroundTasks
) -> dict:
    job_id = f"gen_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
    
    # Job 생성
    job_manager.create_job(job_id, request.model_dump())
    
    # Background 작업 등록
    background_tasks.add_task(
        _run_qa_generation,
        job_id=job_id,
        **request.dict()
    )
    
    return {"success": True, "job_id": job_id}

async def _run_qa_generation(job_id: str, model: str, lang: str, samples: int, ...):
    """Background task: actual QA generation"""
    try:
        # 데이터 로드
        with open("ref/data/data_2026-03-06_normalized.json") as f:
            items = json.load(f)
        items = items[:samples]
        
        # QA 생성 (실제 main.py 함수 호출!)
        for i, item in enumerate(items, 1):
            result = generate_qa(item, model, lang, "v2")
            
            # Progress 업데이트 (Frontend에서 polling)
            progress = int((i / len(items)) * 100)
            job_manager.update_job(
                job_id,
                progress=progress,
                message=f"Generating {i}/{len(items)}"
            )
        
        # 결과 저장 ✓
        job_manager.update_job(
            job_id,
            status=JobStatus.COMPLETED,
            progress=100,
            result_file=filename
        )
        
    except Exception as e:
        job_manager.update_job(job_id, status=JobStatus.FAILED, error=str(e))
```

---

## 🔄 데이터 흐름

### 현재 (분리됨)

```
CLI 사용:
  python main.py --model flashlite --lang ko --samples 8
    └─ output/qa_*.json 생성

API 사용:
  Frontend → Backend API
    └─ Mock 결과만 반환
```

### 통합 후 (연결됨)

```
Frontend UI
  ↓ POST /api/generate
Backend API ←─── 실제 생성 시작 (비동기)
  ├─ Job 생성 (job_id 반환)
  └─ Background: generate_qa() 호출
    ├─ Main.py의 실제 함수 실행
    ├─ API 호출: Anthropic/Google/OpenAI
    ├─ Progress 업데이트
    └─ 결과 JSON 저장 (output/)
  
Frontend (Polling)
  ↓ GET /api/generate/{job_id}/status
Backend
  └─ JobManager 조회 → 현재 progress 반환
  
Frontend
  ├─ Progress bar 업데이트
  ├─ Log 표시
  └─ 완료 시 결과 파일명 표시
```

---

## ⚡ 주요 개선 사항

### 기존 main.py (CLI)
```
$ python main.py --model flashlite --lang ko --samples 100
✓ 로컬에서 직접 실행
✓ 완전한 기능
✗ API 통합 불가

비용: 요청당 개별 API 호출
```

### Backend 통합 후 (API + CLI)
```
# CLI: 기존대로 동작
$ python main.py --model flashlite --lang ko --samples 100

# API: Frontend에서 호출
POST /api/generate (동일한 main.py 함수 호출!)
✓ 같은 로직
✓ Backend에서 관리
✓ Progress 추적
✓ Job 큐 관리 (나중에)
```

---

## 🔧 필요한 수정사항

### Main.py 수정 사항
```python
# Before: if __name__ == "__main__": main()
# After: 함수 모듈화

def main():  # CLI 실행용
    ...

def generate_qa():  # Backend 호출용 (이미 있음!)
    ...
```

**결론**: 거의 수정 필요 없음! main.py의 함수들은 이미 재사용 가능한 구조입니다.

### Backend 수정 (필수)
```python
# 1. main.py import
sys.path.insert(0, str(Path(__file__).parent.parent))
from main import generate_qa

# 2. /api/generate 엔드포인트 구현
# 3. Background task로 actual QA 생성
# 4. Job 상태 추적으로 progress 반환
```

### Frontend (이미 준비됨!)
```typescript
// QAGenerationPanel.improved.tsx에서 이미 API 호출 구현됨!
// - POST /api/generate
// - GET /api/generate/{job_id}/status polling
// - Progress UI 업데이트
```

---

## 📊 아키텍처 비교

| 항목 | 현재 | 통합 후 |
|------|------|--------|
| **CLI 생성** | ✓ main.py 실행 | ✓ 동일 |
| **API 생성** | ✗ 없음 (Mock) | ✓ /api/generate |
| **실시간 진행률** | ✗ 없음 | ✓ Polling |
| **Job 관리** | ✗ 없음 | ✓ JobManager |
| **에러 처리** | ✓ 있음 | ✓ enhanced |
| **코드 재사용** | ✗ 별도 구현 | ✓ main.py 함수 사용 |
| **토큰/비용 계산** | ✓ main.py | ✓ main.py 결과 활용 |

---

## 🚀 구현 우선순위

### 1단계 ⭐ (필수, 30분)
- [ ] `backend/generation_api.py`에서 main.py import
- [ ] `/api/generate` enpoint에서 generate_qa() 호출
- [ ] Background task로 실제 생성 실행

### 2단계 (권장, 30분)
- [ ] 진행률 실시간 업데이트
- [ ] 토큰/비용 정보 포함
- [ ] 에러 상세 정보

### 3단계 (선택, 1시간)
- [ ] Job queue (Celery)
- [ ] SSE streaming
- [ ] 분산 처리

---

## 📋 체크리스트

### Main.py 확인
- [x] 완전한 QA 생성 로직 ✓
- [x] 여러 모델 지원 ✓
- [x] API 호출 구현 ✓
- [x] 결과 저장 ✓
- [x] 함수 단위 분리 ✓ (generate_qa, generate_qa_anthropic, etc.)

### Backend 수정
- [ ] main.py import 추가
- [ ] /api/generate 엔드포인트 구현
- [ ] Background task 실행
- [ ] Progress 업데이트
- [ ] 결과 저장 경로 통일

### Frontend
- [ ] API 호출 구현 (이미 됨!) ✓
- [ ] Progress UI (이미 됨!) ✓
- [ ] Error 처리 (이미 됨!) ✓

### 테스트
- [ ] Backend 실행: main.py 함수 호출 확인
- [ ] Frontend 실행: /api/generate 호출 확인
- [ ] 실시간 progress 업데이트 확인
- [ ] 결과 파일 생성 확인
