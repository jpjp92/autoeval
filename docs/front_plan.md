# 프론트엔드 기획 (Frontend Plan)

> **최종 업데이트**: 2026-03-10
> **기술 스택**: FastAPI (백엔드) + React (프론트엔드)
> **배포**: 프론트 → Vercel / 백엔드 → Render 또는 Railway
> **백엔드 연동**: `main.py` (QA 생성), `qa_quality_evaluator.py` (품질 평가)

---

## 전체 워크플로우

```
[1. QA 생성]  →  [2. 평가 실행]  →  [3. 결과 대시보드]  →  [4. 리포트 다운로드]
  main.py          quality_evaluator      시각화                CSV/XLSX/HTML
```

---

## 아키텍처

```
┌─────────────────────┐         ┌──────────────────────────┐
│  React (Vercel)     │  HTTP   │  FastAPI (Render/Railway) │
│                     │ ──────► │                           │
│  - Vite + TS        │         │  - /api/generate          │
│  - Tailwind CSS     │ ◄────── │  - /api/evaluate          │
│  - Recharts         │  JSON   │  - /api/results           │
│  - React Query      │         │  - /api/export            │
└─────────────────────┘         └──────────┬───────────────┘
                                            │
                                    ┌───────▼────────┐
                                    │  Python 모듈   │
                                    │  main.py       │
                                    │  qa_quality_   │
                                    │  evaluator.py  │
                                    └────────────────┘
```

---

## 디렉토리 구조

```
autoeval/
  backend/                     # FastAPI 앱
    main_api.py                # 진입점 (uvicorn)
    routers/
      generate.py              # POST /api/generate
      evaluate.py              # POST /api/evaluate
      results.py               # GET  /api/results
      export.py                # GET  /api/export/{format}
    schemas/
      generate.py              # Pydantic 요청/응답 모델
      evaluate.py
    core/
      runner.py                # main.py, qa_quality_evaluator.py 래퍼
    requirements.txt

  frontend/                    # React 앱
    src/
      pages/
        Overview.tsx
        Generate.tsx
        Evaluate.tsx
        Dashboard.tsx
        Report.tsx
      components/
        Sidebar.tsx
        charts/
          RadarChart.tsx
          ScoreHistogram.tsx
          DonutChart.tsx
          IntentBarChart.tsx
        QATable.tsx
        QADetailPanel.tsx
      api/
        client.ts              # axios 베이스 설정
        generate.ts
        evaluate.ts
        results.ts
        export.ts
      store/
        useResultStore.ts      # Zustand 전역 상태
    package.json
    vite.config.ts
```

---

## 페이지별 상세

### 홈 (Overview)

현황 한눈에 파악

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ 총 QA 수 │ │ 평가 완료│ │ PASS율   │ │ 최근 실행│
└──────────┘ └──────────┘ └──────────┘ └──────────┘

[ 최근 평가 이력 테이블 ]   [ Layer ② 점수 트렌드 라인차트 ]
```

- API: `GET /api/results` → 전체 결과 파일 목록 + 요약 집계

---

### Page 1: QA 생성

`main.py` 실행 인터페이스

**구성요소**

| 영역 | 내용 |
|------|------|
| Hierarchy 선택기 | `ref/hierarchy.csv` 기반 트리뷰 (체크박스) |
| 생성 옵션 | 모델 선택 / QA 개수 / 언어(KO·EN) |
| 실행 버튼 | `POST /api/generate` 호출 |
| 실시간 로그 | SSE(`EventSource`) 또는 폴링으로 진행 상황 스트리밍 |
| 결과 미리보기 | 생성 완료 후 QA 샘플 5개 테이블 표시 |

**API**
```
POST /api/generate
Body: { hierarchy: [...], model: "gpt-5.1", count: 5, lang: "ko" }
Response (SSE stream): { status, message, progress, result_file }
```

---

### Page 2: 평가 실행

파일 선택 → 평가 방식 선택 → 실행

**구성요소**

| 영역 | 내용 |
|------|------|
| 파일 선택 | `GET /api/results` 로 파일 목록 불러와 드롭다운 |
| 평가 모드 탭 | Quality Evaluator (2-Layer) / RAG Triad / 둘 다 |
| 옵션 | 평가 모델 / 평가 개수 (전체 or N개 테스트) |
| 진행 바 | SSE 스트림으로 현재 처리 QA 번호 + 점수 실시간 수신 |
| 실시간 결과 | QA별 점수 + PASS/FAIL 스트리밍 출력 |

**API**
```
POST /api/evaluate
Body: { file: "qa_...json", mode: "quality|rag|both", model: "gpt-5.1", limit: null }
Response (SSE stream): { index, question, factuality, completeness, groundedness, pass }
```

---

### Page 3: 결과 대시보드

평가 결과 파일 선택 → 시각화

**파일 선택**: `GET /api/results` → `GET /api/results/{filename}` 드롭다운

**API**
```
GET  /api/results              → 결과 파일 목록
GET  /api/results/{filename}   → 특정 파일 상세 데이터
```

#### 탭 1 — Layer ①-B 데이터셋 통계

| 차트 | 설명 |
|------|------|
| 레이더 차트 | 다양성 / 중복률 / 편중도 / 데이터 충족률 |
| 수치 테이블 | 지표별 점수 + 등급 (⭐ / ✓ / → / ✗) |
| Intent 분포 바차트 | intent별 QA 개수 |
| Doc 분포 바차트 | docId별 QA 분포 |

#### 탭 2 — Layer ② QA 품질

| 차트 | 설명 |
|------|------|
| PASS/FAIL 도넛 차트 | 통과율 시각화 |
| 점수 분포 히스토그램 | 사실성 / 완결성 / 근거성 각각 |
| QA 상세 테이블 | 질문 / 답변 / 3개 점수 / 종합 / 판정, 정렬·필터 가능 |

**FAIL 항목 클릭 시 상세 패널**
```
Q: 위약금 계산법은?
A: 위약금은 잔여 약정에 따라...
사실성 0.50  Reasoning: "위약금 기준이 context에 명시 없음..."
근거성 0.50  Reasoning: "일부 주장이 context에서 도출 불가..."
[Context 원문 펼치기]
```

#### 탭 3 — RAG Triad (구현 예정)

- Relevance / Groundedness / Clarity 점수 분포
- TruLens 결과 JSON 연동

---

### Page 4: 리포트 다운로드

**데이터 내보내기**

| 항목 | 형식 | API |
|------|------|-----|
| QA 목록 + 점수 | CSV | `GET /api/export/{filename}?format=csv` |
| 전체 평가 결과 | XLSX | `GET /api/export/{filename}?format=xlsx` |

시트 구성 (XLSX):
- Sheet1: QA 점수 (index / question / answer / factuality / completeness / groundedness / avg_quality / pass)
- Sheet2: Layer ①-B 통계
- Sheet3: 요약

**HTML 대시보드 내보내기**

- Recharts → `html2canvas` + 인라인 데이터로 standalone HTML 생성
- API: `GET /api/export/{filename}?format=html`
- 파일명: `dashboard_{filename}.html`

---

## 기술 스택

### 프론트엔드 (Vercel)

| 용도 | 라이브러리 |
|------|---------|
| 프레임워크 | React + TypeScript (Vite) |
| 스타일링 | Tailwind CSS + shadcn/ui |
| 차트 | Recharts |
| API 통신 | React Query + axios |
| 전역 상태 | Zustand |
| 실시간 스트리밍 | EventSource (SSE) |

```bash
npm create vite@latest frontend -- --template react-ts
npm install tailwindcss recharts @tanstack/react-query axios zustand
```

### 백엔드 (Render / Railway)

| 용도 | 라이브러리 |
|------|---------|
| 웹 프레임워크 | FastAPI + uvicorn |
| SSE 스트리밍 | `fastapi.responses.StreamingResponse` |
| 엑셀 내보내기 | openpyxl |
| 데이터 처리 | pandas |
| QA 평가 연동 | `qa_quality_evaluator.py` 직접 import |
| CORS | `fastapi.middleware.cors` |

```toml
# pyproject.toml 추가 의존성
fastapi
uvicorn[standard]
openpyxl
pandas
python-multipart
```

### 환경변수

```
# 백엔드 (.env)
OPENAI_API_KEY=...
FRONTEND_ORIGIN=https://your-app.vercel.app

# 프론트엔드 (.env)
VITE_API_URL=https://your-api.render.com
```

---

## FastAPI 주요 엔드포인트

```
GET  /api/results                    → 결과 파일 목록
GET  /api/results/{filename}         → 특정 결과 상세
GET  /api/hierarchy                  → hierarchy 트리 구조
POST /api/generate                   → QA 생성 (SSE 스트림)
POST /api/evaluate                   → 품질 평가 실행 (SSE 스트림)
GET  /api/export/{filename}          → 파일 내보내기
     ?format=csv|xlsx|html
```

---

## 구현 우선순위

| 순서 | 작업 | 난이도 | 비고 |
|------|------|--------|------|
| 1 | FastAPI 기본 구조 + `/api/results` | 낮음 | 기존 JSON 읽기 |
| 2 | React 앱 기본 구조 + 대시보드 페이지 | 낮음 | Recharts 시각화 |
| 3 | `/api/export` + 리포트 다운로드 | 낮음 | pandas + openpyxl |
| 4 | SSE 스트리밍 + 평가 실행 페이지 | 중간 | EventSource 연동 |
| 5 | QA 생성 페이지 | 높음 | main.py 래퍼 + SSE |
| 6 | Overview 홈 | 낮음 | 나머지 완성 후 집계 |
| 7 | Vercel + Render/Railway 배포 설정 | 중간 | CORS, 환경변수 설정 |

---

## 배포 구성

```
GitHub
  ├── frontend/   → Vercel (자동 배포, main 브랜치 push시)
  └── backend/    → Render 또는 Railway (Dockerfile 또는 requirements.txt)
```

### Render 배포 설정
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main_api:app --host 0.0.0.0 --port $PORT`

### Railway 배포 설정
- `railway.toml` 또는 `Procfile`로 설정

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|---------|
| 2026-03-10 | 최초 기획 작성 (Streamlit) |
| 2026-03-10 | FastAPI + React 스택으로 변경, Vercel/Render 배포 구성 추가 |
