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
│   │   └── utils.ts                     # cn() 등 유틸리티
│   └── components/
│       ├── layout/
│       │   ├── Sidebar.tsx              # 좌측 탭 네비게이션
│       │   └── Header.tsx               # 상단 헤더 (탭별 타이틀)
│       ├── dashboard/
│       │   ├── DashboardOverview.tsx    # 메인 대시보드 (탭 이동 버튼 포함)
│       │   ├── StatsCards.tsx           # 지표 카드
│       │   └── ActivityChart.tsx        # 활동 차트
│       ├── standardization/
│       │   └── DataStandardizationPanel.tsx  # 문서 업로드 + hierarchy 태깅 UI
│       ├── generation/
│       │   └── QAGenerationPanel.tsx    # QA 생성 UI (L1/L2 드롭다운 + 진행상황)
│       ├── evaluation/
│       │   └── QAEvaluationDashboard.tsx # 4레이어 평가 결과 UI (현재 mock)
│       ├── playground/
│       │   └── ChatPlayground.tsx       # 채팅 플레이그라운드 (미구현)
│       ├── settings/
│       │   └── SettingsPanel.tsx        # 설정 패널 (미구현)
│       └── analytics/
│           └── AnalyticsDashboard.tsx   # 분석 대시보드 (미구현)
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

---

## 세션 플로우 (App.tsx state)

```
[Standardization] 문서 업로드
  → onUploadComplete(filename)
  → App.currentFilename = "테스트데이터_2.pdf"
        ↓
[Generation] currentFilename prop 수신
  → hierarchy-list?filename=xxx  (해당 문서 L1/L2만 로드)
  → generateQA payload에 filename 포함
  → 평가 완료 시 onEvalComplete(evalJobId) 호출
  → App.lastEvalJobId = "uuid..."  + 자동 탭 전환 → evaluation
        ↓
[Evaluation] evalJobId prop 수신
  → (Phase 2 구현 시) GET /api/evaluate/{evalJobId}/status 로 실데이터 렌더링
```

**App.tsx에서 관리하는 state:**

| state | 타입 | 역할 |
|-------|------|------|
| `activeTab` | `string` | 현재 활성 탭 |
| `currentFilename` | `string \| null` | 업로드된 문서 파일명 (문서 스코프 키) |
| `lastEvalJobId` | `string \| null` | 마지막 평가 job UUID (Evaluation 탭 전달용) |

---

## 탭 구성

| 탭 ID | 컴포넌트 | 상태 |
|-------|----------|------|
| `overview` | `DashboardOverview` | 구현됨 |
| `standardization` | `DataStandardizationPanel` | 구현됨 |
| `generation` | `QAGenerationPanel` | 구현됨 |
| `evaluation` | `QAEvaluationDashboard` | mock (Phase 2 예정) |
| `playground` | `ChatPlayground` | 미구현 |
| `settings` | `SettingsPanel` | 미구현 |

---

## API 클라이언트 (`lib/api.ts`)

| 함수 | 메서드 | 설명 |
|------|--------|------|
| `healthCheck()` | `GET /health` | 헬스체크 |
| `getHierarchyList(filename?)` | `GET /api/ingestion/hierarchy-list?filename=` | 문서별 L1/L2 목록 |
| `generateQA(request)` | `POST /api/generate` | QA 생성 job 시작 |
| `evaluateQA(request)` | `POST /api/evaluate` | 평가 job 시작 |
| `getResults()` | `GET /api/results` | 결과 파일 목록 |
| `exportResults(request)` | `POST /api/export` | 결과 내보내기 |

`VITE_API_URL` 환경변수로 백엔드 주소 지정 (기본값: `http://localhost:8000`)

---

## 컴포넌트 Props

### `DataStandardizationPanel`

| prop | 타입 | 설명 |
|------|------|------|
| `setActiveTab?` | `(tab: string) => void` | 탭 전환 |
| `onUploadComplete?` | `(filename: string) => void` | 업로드 완료 시 App에 filename 전달 |

### `QAGenerationPanel`

| prop | 타입 | 설명 |
|------|------|------|
| `currentFilename?` | `string \| null` | 현재 문서 파일명 (hierarchy 필터 + generation payload) |
| `onEvalComplete?` | `(evalJobId: string) => void` | 평가 완료 시 App에 job_id 전달 |

### `QAEvaluationDashboard`

| prop | 타입 | 설명 |
|------|------|------|
| `evalJobId?` | `string \| null` | 평가 job UUID (Phase 2에서 실데이터 연결 예정) |

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

## 향후 계획

| 항목 | 내용 |
|------|------|
| Evaluation Phase 2 | `QAEvaluationDashboard` mock 제거 → `GET /api/evaluate/{id}/status` 실데이터 연결 |
| Evaluation Phase 3 | 과거 평가 결과 이력 드롭다운 조회 |
