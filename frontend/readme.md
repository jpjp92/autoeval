# AutoEval Frontend

> 마지막 업데이트: 2026-04-07

LLM 기반 QA 데이터셋 자동 생성 및 다층 평가 플랫폼의 프론트엔드.

---

## 실행

```bash
npm install
npm run dev      # Dev 서버 (port 3000)
npm run build    # 프로덕션 빌드
npm run lint     # tsc --noEmit 타입 검사
```

---

## 스택

| 구분 | 라이브러리 |
|------|-----------|
| UI | React 19, TypeScript, Tailwind CSS v4 |
| 빌드 | Vite 6 |
| 차트 | Recharts |
| 내보내기 | xlsx, jszip |
| 플로우 다이어그램 | @xyflow/react |
| 애니메이션 | motion |
| 아이콘 | lucide-react |

---

## 아키텍처

```
frontend/src/
├── App.tsx                          # 루트 컴포넌트 — 탭 네비게이션, 알림, 테마
├── main.tsx
├── index.css
│
├── lib/
│   ├── api.ts                       # API 클라이언트 (apiFetch / apiFetchWithRetry 래퍼)
│   ├── evalChartUtils.ts            # 차트 데이터 빌더 + formatKST
│   ├── evalScoreUtils.ts            # 점수 임계값 + getQAStatus
│   ├── utils.ts                     # cn (clsx + tailwind-merge)
│   └── exportUtils/                 # 내보내기 유틸 (4분리)
│       ├── types.ts                 # EvaluationData 인터페이스
│       ├── xlsxBuilder.ts           # buildWorkbook, exportToCSV
│       ├── htmlBuilder.ts           # SVG 차트 3종 + buildHTMLContent + exportToHTML
│       └── index.ts                 # exportToJSON, exportToZip + re-exports (facade)
│
├── types/
│   └── evaluation.ts                # QAStatus, QAPreviewItem, EvalReport, HistoryItem 등
│
└── components/
    ├── layout/
    │   ├── Sidebar.tsx
    │   └── Header.tsx               # 테마 토글, 알림 드롭다운
    │
    ├── dashboard/
    │   ├── DashboardOverview.tsx
    │   ├── StatsCards.tsx
    │   └── ActivityChart.tsx
    │
    ├── standardization/             # Documents 탭
    │   ├── DataStandardizationPanel.tsx   # 파일 업로드 → 계층 분석 → 태깅 (583줄)
    │   └── HierarchyConstructionPanel.tsx
    │
    ├── generation/                  # QA Pipeline 탭
    │   └── QAGenerationPanel.tsx    # 3-Step: 설정 → 생성 → 평가 (832줄)
    │
    ├── evaluation/                  # Evaluation 탭
    │   ├── QAEvaluationDashboard.tsx      # 메인 대시보드 (675줄)
    │   ├── hooks/
    │   │   ├── useEvaluationData.ts       # loading / error / report 상태 + evalJobId fetch
    │   │   ├── useEvalHistory.ts          # 히스토리 목록·선택·QA preview + HistoryReport 타입
    │   │   └── useQATable.ts              # 정렬·필터·페이지네이션 파생 상태
    │   ├── QADetailView.tsx
    │   ├── HistoryDropdown.tsx
    │   ├── shared.tsx                     # ChartInfoTooltip
    │   └── charts/
    │       ├── IntentTreemap.tsx
    │       ├── MetricRadialGauge.tsx
    │       └── QualityScoreChart.tsx
    │
    ├── settings/
    │   ├── SettingsPanel.tsx
    │   └── PipelineFlow.tsx
    │
    └── analytics/
        └── AnalyticsDashboard.tsx
```

---

## API 클라이언트 (`src/lib/api.ts`)

모든 백엔드 통신은 `api.ts`를 통해 이루어집니다.

### 공통 래퍼

| 함수 | 설명 |
|------|------|
| `apiFetch<T>(url, options?)` | 단일 요청. HTTP 에러 → `httpStatusToMessage`로 한국어 변환 |
| `apiFetchWithRetry<T>(url, options, retries?, delayMs?)` | Cold start 대비 재시도 (기본 3회, 5초 간격). 에러 바디 `detail` 파싱 |
| `mapErrorToMessage(error)` | 백엔드 에러 문자열 → 사용자 메시지 변환 |

### 엔드포인트 함수

| 함수 | 메서드 | 경로 |
|------|--------|------|
| `getDashboardMetrics()` | GET | `/api/dashboard/metrics` |
| `getHierarchyList(filename?, filterForQa?)` | GET | `/api/ingestion/hierarchy-list` |
| `uploadDocument(formData)` | POST | `/api/ingestion/upload` |
| `applyGranularTagging(payload)` | POST | `/api/ingestion/apply-granular-tagging` |
| `generateQA(request)` | POST | `/api/generate` |
| `getGenStatus(jobId)` | GET | `/api/generate/{jobId}/status` |
| `getGenPreview(jobId, limit?)` | GET | `/api/generate/{jobId}/preview` |
| `evaluateQA(request)` | POST | `/api/evaluate` |
| `getEvalStatus(jobId)` | GET | `/api/evaluate/{jobId}/status` |
| `getEvalHistory()` | GET | `/api/evaluate/history` |
| `getEvalExport(jobId)` | GET | `/api/evaluate/{jobId}/export` |
| `getEvalExportById(evalId)` | GET | `/api/evaluate/export-by-id/{evalId}` |

---

## 내보내기 (`src/lib/exportUtils/`)

`from '@/src/lib/exportUtils'` import 경로 유지 (index.ts facade).

| 함수 | 포맷 | 설명 |
|------|------|------|
| `exportToCSV(data)` | XLSX | Stats 시트 + Detail 시트 2장 |
| `exportToHTML(data)` | HTML | SVG 차트 + 인터랙티브 QA 테이블 포함 단일 파일 |
| `exportToJSON(data)` | JSON | 정제된 구조로 직렬화 |
| `exportToZip(data)` | ZIP | XLSX + HTML 묶음 |

---

## Evaluation 훅 (`src/components/evaluation/hooks/`)

`QAEvaluationDashboard` 의 상태를 3개 훅으로 분리.

| 훅 | 입력 | 반환 주요 값 |
|----|------|------------|
| `useEvaluationData(evalJobId, onNewJob?)` | evalJobId | `loading`, `error`, `report` |
| `useEvalHistory(initialEvalDbId, onSelect?)` | initialEvalDbId | `historyList`, `historyReport`, `selectedHistoryId`, `selectHistory`, `clearHistory` |
| `useQATable(qaPreview)` | QAPreviewItem[] | `pagedQA`, `totalPages`, `filteredQA`, `resetTable`, 정렬·필터 상태 |

훅 간 조율: `onNewJob` / `onSelect` 콜백을 내부 ref로 관리 → `clearHistory()` + `resetTable()` 안전 호출.

---

## 주요 파일 규모 (2026-04-07 기준)

| 파일 | 줄 수 |
|------|-------|
| `QAGenerationPanel.tsx` | 832 |
| `QAEvaluationDashboard.tsx` | 675 |
| `DataStandardizationPanel.tsx` | 583 |
| `exportUtils/htmlBuilder.ts` | ~615 |
| `api.ts` | 201 |
| `App.tsx` | 142 |
