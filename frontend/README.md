# AutoEval Frontend

React 19 + TypeScript + Tailwind CSS 기반 QA 생성·평가 플랫폼 UI.

---

## 디렉토리 구조

```
frontend/
├── src/
│   ├── App.tsx                          # 앱 루트 — 탭 라우팅 + 세션 state 관리
│   ├── lib/
│   │   ├── api.ts                       # 백엔드 API 클라이언트 (fetch 래퍼)
│   │   ├── exportUtils.ts               # XLSX / HTML / JSON 내보내기 (차트 SVG 인라인 포함)
│   │   └── utils.ts                     # cn() 등 유틸리티
│   └── components/
│       ├── layout/
│       │   ├── Sidebar.tsx              # 글래스 사이드바 — Admin User 클릭 시 Settings 이동
│       │   └── Header.tsx               # 글래스 헤더 — 탭별 타이틀 (인디고 틴트)
│       ├── dashboard/
│       │   ├── DashboardOverview.tsx    # 메인 대시보드 — Supabase 집계 실데이터 연동
│       │   ├── StatsCards.tsx           # 지표 카드 (accent border + glass)
│       │   └── ActivityChart.tsx        # 평가 점수 추이 차트 (recharts)
│       ├── standardization/
│       │   └── DataStandardizationPanel.tsx  # 문서 업로드 + 3단계 계층 태깅 UI
│       ├── generation/
│       │   └── QAGenerationPanel.tsx    # QA 생성 UI (L1/L2 드롭다운 + 진행상황)
│       ├── evaluation/
│       │   └── QAEvaluationDashboard.tsx # 4레이어 평가 결과 + 이력 조회 + 리포트 내보내기
│       │                                 # QA 목록 테이블: 실패유형 배지 (primary_failure 기반)
│       │                                 # QADetailView: 차원별 평가 근거(reason) + 주요 실패 유형 섹션
│       ├── playground/
│       │   └── ChatPlayground.tsx       # 채팅 플레이그라운드 (미구현)
│       └── settings/
│           ├── SettingsPanel.tsx        # 설정 패널 — Profile / API Keys / Pipeline
│           └── PipelineFlow.tsx         # ReactFlow 5-스텝 파이프라인 시각화
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

---

## 세션 플로우 (App.tsx state)

```
[Standardization] 문서 업로드
  → onUploadComplete(filename)        App.currentFilename 설정
  → onTaggingComplete()               App.taggingVersion 증가 (hierarchy 재로드 트리거)
        ↓
[Generation] currentFilename + taggingVersion prop 수신
  → hierarchy-list?filename=xxx       해당 문서 L1/L2만 로드
  → generateQA payload에 filename 포함
  → 평가 완료 시 onEvalComplete(evalJobId) + 자동 탭 전환 → evaluation
        ↓
[Evaluation] evalJobId prop 수신
  → GET /api/evaluate/{evalJobId}/status  실데이터 렌더링
  → 이력 조회: GET /api/evaluate/history
  → 상세 내보내기: GET /api/evaluate/export-by-id/{eval_id}
```

**App.tsx에서 관리하는 state:**

| state | 타입 | 역할 |
|-------|------|------|
| `activeTab` | `string` | 현재 활성 탭 |
| `currentFilename` | `string \| null` | 업로드된 문서 파일명 (문서 스코프 키) |
| `lastEvalJobId` | `string \| null` | 마지막 평가 job UUID (Evaluation 탭 전달용) |
| `taggingVersion` | `number` | 태깅 완료 시 증가 — Generation의 hierarchy 재로드 트리거 |

---

## 탭 구성

| 탭 ID | 컴포넌트 | 상태 |
|-------|----------|------|
| `overview` | `DashboardOverview` | 구현됨 — Supabase 실데이터 |
| `standardization` | `DataStandardizationPanel` | 구현됨 |
| `generation` | `QAGenerationPanel` | 구현됨 |
| `evaluation` | `QAEvaluationDashboard` | 구현됨 — 이력 조회 + 리포트 내보내기 (XLSX/HTML/JSON), 실패유형 배지, 평가 근거 섹션 |
| `playground` | `ChatPlayground` | 미구현 |
| `settings` | `SettingsPanel` | 구현됨 — Profile / API Keys / Pipeline 시각화 |

> Settings는 사이드바 메뉴 대신 **Admin User 영역 클릭**으로 접근.
> full-bleed 레이아웃 — 헤더 바로 아래 전체 화면 채움.

---

## API 클라이언트 (`lib/api.ts`)

| 함수 | 메서드 | 설명 |
|------|--------|------|
| `getDashboardMetrics()` | `GET /api/dashboard/metrics` | 대시보드 집계 데이터 |
| `getHierarchyList(filename?)` | `GET /api/ingestion/hierarchy-list` | 문서별 L1/L2/L3 목록 |
| `generateQA(request)` | `POST /api/generate` | QA 생성 job 시작 |
| `evaluateQA(request)` | `POST /api/evaluate` | 평가 job 시작 |
| `getEvalStatus(jobId)` | `GET /api/evaluate/{jobId}/status` | 평가 job 상태 + 레이어별 결과 |
| `getEvalHistory()` | `GET /api/evaluate/history` | Supabase 저장된 평가 이력 |
| `getEvalExport(jobId)` | `GET /api/evaluate/{jobId}/export` | 세션 job 상세 내보내기 |
| `getEvalExportById(evalId)` | `GET /api/evaluate/export-by-id/{evalId}` | Supabase eval_id 기반 내보내기 |

`VITE_API_URL` 환경변수로 백엔드 주소 지정 (기본값: `http://localhost:8000`)

---

## 컴포넌트 Props

### `DataStandardizationPanel`

| prop | 타입 | 설명 |
|------|------|------|
| `setActiveTab` | `(tab: string) => void` | 탭 전환 |
| `onUploadComplete` | `(filename: string) => void` | 업로드 완료 시 App에 filename 전달 |
| `onTaggingComplete` | `() => void` | 태깅 완료 시 taggingVersion 증가 트리거 |

### `QAGenerationPanel`

| prop | 타입 | 설명 |
|------|------|------|
| `currentFilename` | `string \| null` | 현재 문서 파일명 |
| `taggingVersion` | `number` | 변경 시 hierarchy-list 재요청 |
| `onEvalComplete` | `(evalJobId: string) => void` | 평가 완료 시 App에 job_id 전달 |
| `onGoToEvaluation` | `() => void` | 평가 탭으로 자동 이동 |

### `QAEvaluationDashboard`

| prop | 타입 | 설명 |
|------|------|------|
| `evalJobId` | `string \| null` | 마지막 평가 job UUID |

### `DashboardOverview`

| prop | 타입 | 설명 |
|------|------|------|
| `setActiveTab` | `(tab: string) => void` | Quick Actions 탭 이동 |
| `isActive` | `boolean` | overview 탭 활성 시 API 재요청 트리거 |

---

## 개발 서버

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # 프로덕션 빌드
```

### 환경변수 (`.env`)

```
VITE_API_URL=http://localhost:8000
```

---

**Last Updated**: 2026-03-20 | **Branch**: main
