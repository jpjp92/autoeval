<!--
파일: REF_FRONTFLOW.md
설명: React 프론트엔드 컴포넌트 구조 및 API 연동 흐름 정리. 탭 라우팅, 문서 업로드·계층 태깅·QA 생성·평가 대시보드 각 화면의 상태 흐름과 API 호출 구조 포함.
업데이트: 2026-04-06
-->
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
export const API_BASE = '';  // 빈 문자열 고정
```
- 로컬/Docker/Vercel 모두 동일하게 빈 문자열 사용
- 로컬: Vite 프록시(`vite.config.ts`)가 `/api/*` → `http://localhost:8000` 포워딩
- Docker: nginx가 `/api/*` → 백엔드 컨테이너 프록시
- Vercel: `vercel.json` rewrites로 `/api/*` → Render URL 프록시

---

## 컴포넌트 구조

```
App.tsx (탭 라우팅 + 전역 상태 관리)
├── Sidebar.tsx                          — 네비게이션 (4탭 + 하단 Settings)
├── Header.tsx                           — 상단 바 (테마 스위치 + 알림)
│
├── [overview]      DashboardOverview.tsx         — 대시보드
├── [standardization] DataStandardizationPanel.tsx — 문서 업로드·계층 태깅
│                     └── HierarchyConstructionPanel.tsx — 계층 트리 표시
├── [generation]    QAGenerationPanel.tsx          — QA 생성
├── [evaluation]    QAEvaluationDashboard.tsx       — 평가
│                   ├── HistoryDropdown.tsx
│                   ├── QADetailView.tsx
│                   └── charts/  (IntentTreemap, MetricRadialGauge, QualityScoreChart)
└── [settings]      SettingsPanel.tsx              — 설정
                    └── PipelineFlow.tsx            — 파이프라인 도식도 (ReactFlow)
```

> **컴포넌트 마운트 전략**: 탭 전환 시 `hidden` 클래스로 숨김 처리 — 내부 상태(폴링·입력값 등) 보존.

**App.tsx 전역 상태**
- `currentFilename` — 업로드 완료된 파일명 → `QAGenerationPanel`에 전달
- `taggingVersion` + `taggingTreeData` — 태깅 완료 시 계층 트리를 `QAGenerationPanel`에 직접 전달 (API 중복 호출 방지)
- `lastEvalJobId` — 인메모리 평가 jobId (세션 내)
- `lastEvalDbId` — DB 히스토리 evalId (대시보드 클릭 시)

---

## 탭별 플로우

### Documents 탭 — 표준화 (`DataStandardizationPanel.tsx`)

```
Step 1. 문서 업로드
  └── POST /api/ingestion/upload
      → 업로드 완료 후 청크 수 표시
      → onUploadComplete(filename) → App.tsx의 currentFilename 갱신

Step 2. 컨텍스트 분석 (버튼 1개로 2단계 순차 실행)
  ├── 1단계: POST /api/ingestion/analyze-hierarchy
  │     → H1/H2/H3 master + domain_profile 한 번에 생성
  │     → h1_candidates, h2_h3_master, document_id 반환
  │     → document_id를 localStorage에 저장 (`document_id:{filename}`)
  └── 2단계: POST /api/ingestion/apply-granular-tagging
        body: { filename, selected_h1_list, h2_h3_master, document_id }
        → 청크별 hierarchy 태깅 배치 처리
        → 완료 시 samples + hierarchyTree 표시
        → onTaggingComplete(treeData) → App.tsx의 taggingTreeData 갱신
```

> **analyze-h2-h3 엔드포인트는 프론트에서 호출하지 않음** — `analyze-hierarchy`가 Pass1+2를 통합 실행.

**상태 변수**
- `uploadedFilename` — 업로드 완료 파일명
- `analysis` — H1 후보·h2_h3_master 분석 결과
- `selectedH1s` — H1 후보 목록 (분석 결과에서 자동 설정)
- `taggingSamples` — 태깅 완료 후 샘플 청크
- `hierarchyTree` — 표시용 계층 트리 (`filter_for_qa=false`)

---

### QA Pipeline 탭 — QA 생성 (`QAGenerationPanel.tsx`)

```
계층 필터 로딩 (두 경로 중 하나)
  ├── taggingTreeData 있음 (태깅 직후): App.tsx에서 직접 props로 받아 반영 (API 호출 없음)
  └── taggingTreeData 없음 (탭 재진입 등): GET /api/ingestion/hierarchy-list?filename=...

Step 1. 생성 설정
  ├── 모델 선택 (Claude Sonnet / Gemini Flash / GPT 등)
  ├── 언어 선택 (KO / EN)
  ├── 샘플 수, QA per doc 설정
  ├── H1/H2/H3 계층 필터 드롭다운 선택
  └── Auto-evaluate 토글 (생성 후 자동 평가 여부)

Step 2. QA 생성 실행
  ├── POST /api/generate → job_id 수신
  │     body: { model, lang, samples, qa_per_doc, prompt_version,
  │             filename, hierarchy_h1/h2/h3, doc_ids? }
  ├── Polling: fetch `/api/generate/{job_id}/status` (직접 fetch, 1초 간격)
  │   → progress 바, 상태 메시지 표시
  └── 완료 시: fetch `/api/generate/{job_id}/preview?limit=3`
      → 샘플 3개 카드 표시 (컨텍스트 + Q/A + 의도 배지)

Step 3. 자동 평가 (Auto-evaluate ON 시)
  ├── POST /api/evaluate (직접 fetch)
  │     body: { result_filename, evaluator_model, generation_id }
  ├── Polling: fetch `/api/evaluate/{job_id}/status`
  └── 완료 시: onEvalComplete(evalJobId) → App.tsx의 lastEvalJobId 갱신
      → onGoToEvaluation() → Evaluation 탭으로 이동
```

**의도 배지 한국어 레이블** (`intentLabel` 함수)
```
fact       → 사실형    purpose    → 원인형    how        → 방법형
condition  → 조건형    comparison → 비교형    list       → 열거형
factoid    → 사실형    definition → 정의형    boolean    → 확인형
```

---

### Evaluation 탭 — 평가 (`QAEvaluationDashboard.tsx`)

```
진입 방법
  1. QA Pipeline 탭에서 자동 이동 (lastEvalJobId props)
  2. Dashboard 탭에서 히스토리 클릭 (lastEvalDbId props)
  3. 탭 직접 접근 → 히스토리 드롭다운으로 선택

평가 실행 (인메모리 jobId 있는 경우)
  ├── POST /api/evaluate (evaluateQA)
  ├── Polling: GET /api/evaluate/{job_id}/status (getEvalStatus)
  └── 완료 시 결과 표시:
      ├── 요약 카드 (총 QA, 유효 QA, 최종 점수, 등급)
      ├── 의도 분포 (IntentTreemap)
      ├── 데이터 통계 (MetricRadialGauge — Layer 1-B)
      ├── 품질 점수 (QualityScoreChart — Layer 3)
      └── 상세 QA 테이블 (QADetailView — Layer별 점수, pass/fail)

히스토리
  ├── GET /api/evaluate/history (getEvalHistory) → HistoryDropdown 구성
  └── 선택 시: GET /api/evaluate/export-by-id/{id} (getEvalExportById)

Export
  ├── XLSX: exportToCSV(evaluationData)  — 2시트 (Stats + Detail)
  └── HTML Report: exportToHTML(evaluationData)  — SVG 차트 포함 독립 HTML
```

---

### Dashboard 탭 — 대시보드 (`DashboardOverview.tsx`)

```
GET /api/dashboard/metrics
  └── StatsCards.tsx — KPI 카드 (total_qa, avg_score, doc_count, pass_rate)
      ActivityChart.tsx — 평가 점수 추이 (AreaChart)
        ├── x축: 날짜 (MM/DD, 같은 날짜 첫 번째만 표시)
        └── Tooltip: 날짜 + 문서명 + 점수
      등급 분포 (파이 차트)
  └── 히스토리 항목 클릭 → onEvalSelect(evalId) → Evaluation 탭으로 이동
```

---

### Settings 탭 — 설정 (`SettingsPanel.tsx`)

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

| 함수 | 메서드 | 엔드포인트 | 비고 |
|------|--------|-----------|------|
| `getDashboardMetrics()` | GET | `/api/dashboard/metrics` | |
| `getHierarchyList(filename?, filterForQa?)` | GET | `/api/ingestion/hierarchy-list` | `filterForQa=false` → QA 필터 없이 전체 반환 |
| `generateQA(request)` | POST | `/api/generate` | |
| `evaluateQA(request)` | POST | `/api/evaluate` | |
| `getEvalStatus(jobId)` | GET | `/api/evaluate/{jobId}/status` | |
| `getEvalHistory()` | GET | `/api/evaluate/history` | |
| `getEvalExport(jobId)` | GET | `/api/evaluate/{jobId}/export` | |
| `getEvalExportById(evalId)` | GET | `/api/evaluate/export-by-id/{evalId}` | |

> **직접 `fetch()` 호출** (api.ts 미경유):
> - `QAGenerationPanel`: `/api/generate/{jobId}/status`, `/api/generate/{jobId}/preview?limit=3`, `/api/evaluate`, `/api/evaluate/{jobId}/status`
> - `DataStandardizationPanel`: `/api/ingestion/upload`, `/api/ingestion/analyze-hierarchy`, `/api/ingestion/apply-granular-tagging` (cold start 대비 `fetchWithRetry` — 최대 3회, 5초 간격)
