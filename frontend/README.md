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
│   │   ├── exportUtils.ts               # XLSX / HTML / JSON / ZIP 내보내기 (차트 SVG 인라인)
│   │   └── utils.ts                     # cn() 등 유틸리티
│   └── components/
│       ├── layout/
│       │   ├── Sidebar.tsx              # 글래스 사이드바 — 4개 탭 메뉴 + 하단 Settings 버튼
│       │   └── Header.tsx               # 글래스 헤더 — 탭별 타이틀 + 알림 + 다크모드 토글
│       ├── dashboard/
│       │   ├── DashboardOverview.tsx    # 메인 대시보드 — 모델별 성능 리더보드 + 파이프라인 로그
│       │   ├── StatsCards.tsx           # 지표 카드 (accent border + glass)
│       │   └── ActivityChart.tsx        # 평가 점수 추이 차트 (현재 주석 처리)
│       ├── standardization/
│       │   └── DataStandardizationPanel.tsx  # 문서 업로드 + 2단계 계층 분석·태깅 UI
│       ├── generation/
│       │   └── QAGenerationPanel.tsx    # QA 생성 UI (H1/H2 드롭다운 + 진행상황)
│       ├── evaluation/
│       │   └── QAEvaluationDashboard.tsx # 4레이어 평가 결과 + 이력 조회 + 리포트 내보내기
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
[Dashboard] 파이프라인 로그 조회
  → recent_jobs (평가 로그 표시)
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
    - document_id: localStorage에서 `document_id:{filename}` 키로 조회
    - sample_doc_chunks RPC 균등 샘플링 → H1/H2/H3 후처리 필터링
  → 평가 완료 시 onEvalComplete(evalJobId) + 자동 탭 전환 → evaluation
        ↓
[Evaluation] evalJobId + initialEvalDbId prop 수신
  → evalJobId: 세션 in-memory job → 실시간 결과 표시
  → initialEvalDbId: 대시보드 로그 클릭 연동 → historyList 로드 후 자동 선택
  → 또는 수동: History 드롭다운 → 이력 선택
```

**App.tsx에서 관리하는 state:**

| state | 타입 | 역할 |
|-------|------|------|
| `activeTab` | `string` | 현재 활성 탭 |
| `currentFilename` | `string \| null` | 업로드된 문서 파일명 |
| `lastEvalJobId` | `string \| null` | 마지막 생성 job UUID (Generation 세션 in-memory용) |
| `lastEvalDbId` | `string \| null` | 마지막 평가 Supabase record ID (대시보드 로그 연동) |
| `taggingVersion` | `number` | 태깅 완료 시 증가 — Generation hierarchy 재로드 트리거 |
| `taggingTreeData` | `HierarchyTree \| null` | 태깅 완료 시점 tree 데이터 — Generation API 중복 호출 방지 |
| `settingsSection` | `string \| undefined` | Settings 탭 진입 시 초기 섹션 지정 |
| `notifications` | `Notification[]` | 헤더 알림 목록 |

---

## 탭 구성

| 탭 ID | 컴포넌트 | 상태 |
|-------|----------|------|
| `overview` | `DashboardOverview` | 구현됨 — Dashboard |
| `standardization` | `DataStandardizationPanel` | 구현됨 — Documents |
| `generation` | `QAGenerationPanel` | 구현됨 — QA Pipeline |
| `evaluation` | `QAEvaluationDashboard` | 구현됨 — Evaluation |
| `settings` | `SettingsPanel` | 구현됨 — 사이드바 하단 Settings 버튼으로 접근 |

---

## API 클라이언트 (`lib/api.ts`)

| 함수 | 메서드 | 설명 |
|------|--------|------|
| `getDashboardMetrics()` | `GET /api/dashboard/metrics` | 대시보드 집계 데이터 |
| `getHierarchyList(filename?)` | `GET /api/ingestion/hierarchy-list` | 문서별 H1/H2/H3 목록 |
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
| `onTaggingComplete` | `(treeData: HierarchyTree) => void` | 태깅 완료 시 tree 데이터와 함께 전달 |

### `QAGenerationPanel`

| prop | 타입 | 설명 |
|------|------|------|
| `currentFilename` | `string \| null` | 현재 문서 파일명 |
| `taggingVersion` | `number` | 변경 시 hierarchy 재로드 트리거 |
| `taggingTreeData` | `HierarchyTree \| null` | 태깅 완료 시점 데이터 — API 중복 호출 방지 |
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

**Last Updated**: 2026-04-01 | **Branch**: main
