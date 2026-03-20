# Frontend Flow

## 진입점

```
frontend/src/
├── main.tsx          # React 앱 마운트
├── App.tsx           # 탭 라우팅 + 레이아웃
└── lib/
    └── api.ts        # API 클라이언트 (API_BASE 설정)
```

**API_BASE 설정**
```ts
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
```
- 로컬: `http://localhost:8000`
- Docker: 빈 문자열 → nginx가 `/api/*` 프록시
- Vercel: `VITE_API_URL=https://autoeval-uccr.onrender.com`

---

## 컴포넌트 구조

```
App.tsx (탭 라우팅)
├── Sidebar.tsx              — 네비게이션 (5탭)
├── Header.tsx               — 상단 바
│
├── [탭1] DataStandardizationPanel.tsx   — 표준화
├── [탭2] QAGenerationPanel.tsx          — QA 생성
├── [탭3] QAEvaluationDashboard.tsx      — 평가
├── [탭4] DashboardOverview.tsx          — 대시보드
└── [탭5] SettingsPanel.tsx              — 설정
         └── PipelineFlow.tsx            — 파이프라인 도식도
```

---

## 탭별 플로우

### 탭1 — 표준화 (`DataStandardizationPanel.tsx`)

```
Step 1. PDF 업로드
  └── POST /api/ingestion/upload
      → 업로드 완료 후 청크 수 표시

Step 2. H1 분석
  └── POST /api/ingestion/analyze-hierarchy
      → h1_candidates 목록 표시
      → 사용자가 H1 선택/수정

Step 3. H2/H3 분석
  └── POST /api/ingestion/analyze-h2-h3 (selected_h1_list 전달)
      → h2_h3_master 계층 트리 표시
      → 사용자가 H2/H3 확인

Step 4. 계층 태깅 적용
  └── POST /api/ingestion/apply-granular-tagging (h2_h3_master 전달)
      → 배치별 진행률 표시
      → 완료 시 샘플 미리보기 (h1/h2/h3)
```

**상태 변수**
- `selectedH1s` — 선택된 H1 목록
- `h2h3Master` — H2/H3 마스터 계층
- `expandedH1`, `expandedH2` — 트리 펼침 상태

---

### 탭2 — QA 생성 (`QAGenerationPanel.tsx`)

```
Step 1. 생성 설정
  ├── 모델 선택 (Claude Sonnet / Gemini Flash / GPT-5.2 등)
  ├── 언어 선택 (KO / EN)
  ├── 샘플 수, QA per doc 설정
  └── H1/H2/H3 계층 필터 선택
      └── GET /api/ingestion/hierarchy-list → 드롭다운 구성

Step 2. QA 생성 실행
  ├── POST /api/generation/generate → job_id 수신
  ├── Polling: GET /api/generation/{job_id}/status (1초 간격)
  │   → progress 바, 상태 메시지 표시
  └── 완료 시: GET /api/generation/{job_id}/preview
      → 샘플 3개 카드 표시 (컨텍스트 + Q/A + 의도 배지)

Step 3. QA 평가 이동
  └── 평가 탭으로 자동 이동 (result_id 전달)
```

**의도 배지 한국어 레이블**
```
factual→사실형  definition→정의형  procedural→방법형
list→목록형     causal→원인형     numerical→수치형
boolean→확인형  process→방법형
```

---

### 탭3 — 평가 (`QAEvaluationDashboard.tsx`)

```
평가 실행
  ├── POST /api/evaluation/evaluate (result_filename, evaluator_model)
  ├── Polling: GET /api/evaluation/{job_id}/status
  └── 완료 시 결과 표시:
      ├── 요약 카드 (총 QA, 유효 QA, 최종 점수, 등급)
      ├── 의도 분포 (PieChart)
      ├── 데이터 통계 (RadarChart — Layer 1-B)
      ├── 품질 점수 (가로 바 — Layer 3)
      └── 상세 QA 테이블 (Layer별 점수, pass/fail)

히스토리
  └── GET /api/evaluation/history → 이전 평가 목록
      → 클릭 시 상세 결과 로드 (GET /api/evaluation/export-by-id/{id})

Export
  ├── XLSX: exportToCSV(evaluationData)  — 2시트 (Stats + Detail)
  └── HTML Report: exportToHTML(evaluationData)  — SVG 차트 포함 독립 HTML
```

---

### 탭4 — 대시보드 (`DashboardOverview.tsx`)

```
GET /api/dashboard/metrics
  └── StatsCards.tsx — KPI 카드 (total_qa, avg_score, doc_count, pass_rate)
      ActivityChart.tsx — 평가 점수 추이 (AreaChart)
        ├── x축: 날짜 (MM/DD, 같은 날짜 첫 번째만 표시)
        └── Tooltip: 날짜 + 문서명 + 점수
      등급 분포 (파이 차트)
```

---

### 탭5 — 설정 (`SettingsPanel.tsx`)

```
├── API 키 입력 (Anthropic / Google / OpenAI / Supabase)
└── PipelineFlow.tsx — ReactFlow 5단계 파이프라인 도식도
    ├── Stage 1: 데이터 수집 (Upload)
    ├── Stage 2: 계층 분류 (H1 도출 → H2/H3 도출)
    ├── Stage 3: QA 생성 (H1/H2 필터 → 생성)
    ├── Stage 4: 평가 (4레이어)
    └── Stage 5: 대시보드
```

---

## API 클라이언트 함수 목록 (`api.ts`)

| 함수 | 메서드 | 엔드포인트 |
|------|--------|-----------|
| `getDashboardMetrics()` | GET | `/api/dashboard/metrics` |
| `getHierarchyList(filename?)` | GET | `/api/ingestion/hierarchy-list` |
| `generateQA(request)` | POST | `/api/generation/generate` |
| `getGenStatus(jobId)` | GET | `/api/generation/{jobId}/status` |
| `getGenPreview(jobId)` | GET | `/api/generation/{jobId}/preview` |
| `evaluateQA(request)` | POST | `/api/evaluation/evaluate` |
| `getEvalStatus(jobId)` | GET | `/api/evaluation/{jobId}/status` |
| `getEvalHistory()` | GET | `/api/evaluation/history` |
| `getEvalExport(jobId)` | GET | `/api/evaluation/{jobId}/export` |
| `getEvalExportById(evalId)` | GET | `/api/evaluation/export-by-id/{evalId}` |
