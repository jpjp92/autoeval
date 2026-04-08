# AutoEval Frontend

> 마지막 업데이트: 2026-04-08

LLM 기반 QA 데이터셋 자동 생성 및 다층 평가 플랫폼의 프론트엔드.

---

## 실행

```bash
npm install
npm run dev      # Dev 서버 (http://localhost:3000)
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
| 아이콘 | lucide-react |

---

## 디렉토리 구조

```
frontend/src/
├── App.tsx                          # 루트 컴포넌트 — 탭 네비게이션, 알림, 테마
├── main.tsx
├── index.css
│
├── lib/
│   ├── api.ts                       # API 클라이언트 (apiFetch / apiFetchWithRetry 래퍼)
│   ├── evalChartUtils.ts            # 차트 데이터 빌더 + formatKST + SummaryStat/TooltipItem 타입
│   ├── evalScoreUtils.ts            # 점수 임계값 + getQAStatus
│   ├── utils.ts                     # cn (clsx + tailwind-merge)
│   └── exportUtils/                 # 내보내기 유틸 (4분리)
│       ├── types.ts                 # EvaluationData 인터페이스
│       ├── xlsxBuilder.ts           # buildWorkbook, exportToCSV
│       ├── htmlBuilder.ts           # SVG 차트 3종 + buildHTMLContent + exportToHTML (~615줄)
│       └── index.ts                 # exportToJSON, exportToZip + re-exports (facade)
│
├── types/
│   ├── evaluation.ts                # QAStatus, QAPreviewItem, EvalReport, HistoryItem 등
│   └── hierarchy.ts                 # HierarchyTree 공통 타입
│
└── components/
    ├── ErrorBoundary.tsx            # 앱 루트 래핑 — TypeError 시 화면 소멸 방지
    ├── layout/
    │   ├── Sidebar.tsx              # 글래스 사이드바 — 탭 메뉴 + Settings 버튼
    │   └── Header.tsx               # 테마 토글, 알림 드롭다운
    │
    ├── dashboard/
    │   ├── DashboardOverview.tsx    # 메인 대시보드 — 모델별 성능 리더보드 + 파이프라인 로그
    │   ├── StatsCards.tsx
    │   └── ActivityChart.tsx
    │
    ├── standardization/             # Documents 탭
    │   └── DataStandardizationPanel.tsx   # 파일 업로드 → 계층 분석 → 태깅 (~581줄)
    │
    ├── generation/                  # QA Pipeline 탭
    │   └── QAGenerationPanel.tsx    # 3-Step: 설정 → 생성 → 평가 (~822줄)
    │
    ├── evaluation/                  # Evaluation 탭
    │   ├── QAEvaluationDashboard.tsx      # 메인 대시보드 (~663줄)
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
    │   └── PipelineFlow.tsx         # ReactFlow 5-스텝 파이프라인 시각화
    │
    └── analytics/
        └── AnalyticsDashboard.tsx
```

---

## 탭 구성

| 탭 ID | 컴포넌트 | 설명 |
|-------|----------|------|
| `overview` | `DashboardOverview` | 모델별 성능 리더보드 + 파이프라인 로그 |
| `standardization` | `DataStandardizationPanel` | 문서 업로드 + 계층 분석·태깅 |
| `generation` | `QAGenerationPanel` | QA 생성 + 자동 평가 |
| `evaluation` | `QAEvaluationDashboard` | 평가 결과 + 히스토리 |
| `settings` | `SettingsPanel` | 사이드바 하단 Settings 버튼으로 접근 |

> 모든 탭 컴포넌트는 항상 마운트 유지(`hidden` class 토글) — 세션 상태 보존을 위한 의도적 설계

---

## 세션 플로우 (App.tsx state)

```
[Dashboard] 파이프라인 로그 조회
  → 행 클릭 → onEvalSelect(eval_id) → lastEvalDbId 설정 + 평가 탭 이동
        ↓
[Standardization] 문서 업로드
  → onUploadComplete(filename)          App.currentFilename 설정
  → 업로드 완료 → document_id localStorage 저장 (`document_id:{filename}`)
  → 계층 분석 + 태깅 완료
  → onTaggingComplete(treeData)         App.taggingTreeData 설정 + taggingVersion 증가
        ↓
[Generation] currentFilename + taggingVersion + taggingTreeData prop 수신
  → taggingTreeData 있으면 API 호출 없이 H1/H2/H3 드롭다운 직접 반영
  → taggingTreeData 없는 초기 파일 선택 시만 hierarchy-list API 직접 조회
  → generateQA payload: { filename, document_id, hierarchy_h1/h2/h3 }
  → 평가 완료 시 onEvalComplete(evalJobId) + 자동 탭 전환 → evaluation
        ↓
[Evaluation] evalJobId + initialEvalDbId prop 수신
  → evalJobId: 세션 in-memory job → 실시간 결과 표시
  → initialEvalDbId: 대시보드 로그 클릭 연동 → historyList 로드 후 자동 선택
  → 수동: History 드롭다운 → 이력 선택
```

### App.tsx 관리 state

| state | 타입 | 역할 |
|-------|------|------|
| `activeTab` | `string` | 현재 활성 탭 |
| `currentFilename` | `string \| null` | 업로드된 문서 파일명 |
| `lastEvalJobId` | `string \| null` | 마지막 생성 job UUID (Generation 세션 in-memory용) |
| `lastEvalDbId` | `string \| null` | 마지막 평가 Supabase record ID (대시보드 로그 연동) |
| `taggingVersion` | `number` | 태깅 완료 시 증가 — Generation hierarchy 재로드 트리거 |
| `taggingTreeData` | `HierarchyTree \| null` | 태깅 완료 시점 tree 데이터 — Generation API 중복 호출 방지 |
| `settingsSection` | `string \| undefined` | Settings 탭 진입 시 초기 섹션 지정 |
| `theme` | `'light' \| 'dark'` | 다크/라이트 모드 (localStorage 연동) |
| `notifications` | `Notification[]` | 헤더 알림 목록 |

---

## API 클라이언트 (`src/lib/api.ts`)

백엔드 주소는 `API_BASE` 상수로 관리 (로컬: `''` — Vite 프록시, 배포: `vercel.json` rewrites).

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
| `analyzeHierarchy(filename)` | POST | `/api/ingestion/analyze-hierarchy` |
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

`QAEvaluationDashboard` 상태를 3개 훅으로 분리.

| 훅 | 입력 | 반환 주요 값 |
|----|------|------------|
| `useEvaluationData(evalJobId, onNewJob?)` | evalJobId | `loading`, `error`, `report` |
| `useEvalHistory(initialEvalDbId, onSelect?)` | initialEvalDbId | `historyList`, `historyReport`, `selectedHistoryId`, `selectHistory`, `clearHistory` |
| `useQATable(qaPreview)` | QAPreviewItem[] | `pagedQA`, `totalPages`, `filteredQA`, `resetTable`, 정렬·필터 상태 |

훅 간 조율: `onNewJob` / `onSelect` 콜백을 내부 ref로 관리 → `clearHistory()` + `resetTable()` 안전 호출.

---

## 컴포넌트 Props

### `DataStandardizationPanel`

| prop | 타입 | 설명 |
|------|------|------|
| `setActiveTab` | `(tab: string) => void` | 탭 전환 |
| `onUploadComplete` | `(filename: string) => void` | 업로드 완료 시 App에 filename 전달 |
| `onTaggingComplete` | `(treeData: HierarchyTree) => void` | 태깅 완료 시 tree 데이터와 함께 전달 |

### `QAGenerationPanel`

| prop | 타입 | 설명 |
|------|------|------|
| `currentFilename` | `string \| null` | 현재 문서 파일명 |
| `taggingVersion` | `number` | 변경 시 hierarchy 재로드 트리거 |
| `taggingTreeData` | `HierarchyTree \| null` | 태깅 완료 시점 데이터 — API 중복 호출 방지 |
| `onGenerationComplete` | `() => void` | 생성 완료 시 App 알림 콜백 |
| `onEvalComplete` | `(evalJobId: string) => void` | 평가 완료 시 App에 job_id 전달 |
| `onGoToEvaluation` | `() => void` | 평가 탭으로 자동 이동 |

### `QAEvaluationDashboard`

| prop | 타입 | 설명 |
|------|------|------|
| `evalJobId` | `string \| null` | 세션 in-memory job ID (실시간 결과 표시용) |
| `initialEvalDbId` | `string \| null` | 초기 평가 Supabase record ID (대시보드 로그 클릭 연동) |
| `setActiveTab` | `(tab: string) => void` | 탭 전환 |

### `DashboardOverview`

| prop | 타입 | 설명 |
|------|------|------|
| `setActiveTab` | `(tab: string) => void` | Quick Actions / 평가 탭 이동 |
| `onEvalSelect` | `(eval_id: string) => void` | 파이프라인 로그 행 클릭 시 평가 ID 전달 |
| `isActive` | `boolean` | overview 탭 활성 시 API 재요청 트리거 |
| `onPipelineClick` | `() => void` | Pipeline 카드 클릭 시 Settings 패널 pipeline 섹션으로 이동 |

---

## 주요 파일 규모

| 파일 | 줄 수 |
|------|-------|
| `QAGenerationPanel.tsx` | 822 |
| `QAEvaluationDashboard.tsx` | 663 |
| `exportUtils/htmlBuilder.ts` | 615 |
| `DataStandardizationPanel.tsx` | 581 |
| `api.ts` | 267 |
| `App.tsx` | 146 |
