# UI 리디자인 계획 — Luminous Clarity

> 최초 작성: 2026-03-27 / 재정리: 2026-03-28
> 레퍼런스: `test/uidesign/ui_sample1~4` / `test/uidesign/ui_sample4/DESIGN.md`

---

## 디자인 방향

**"Luminous Clarity"** — 글래스모피즘 + Pastel Canvas
단단한 박스 레이아웃을 탈피해 투명도·블러·여백으로 공간감을 만드는 프리미엄 SaaS 스타일.

### 핵심 원칙
- **No-Line Rule**: 1px solid border 영역 구분 금지 → 배경색 차이(tonal layering)로 대체
- **Extra Round**: 외부 컨테이너 `rounded-3xl`, 내부 요소 `rounded-xl`
- **Glassmorphism**: `bg-white/70 dark:bg-white/10 backdrop-blur-xl`
- **Ambient Shadow**: blur 40-60px, opacity 4-8% (tinted indigo-grey)
- **폰트**: Manrope (200-800 weight)

---

## 색상 토큰

### Light Mode
| 토큰 | 값 | 용도 |
|---|---|---|
| `primary` | `#4647d3` | 주요 액션, 포커스 |
| `primary-container` | `#9396ff` | 버튼 그라디언트 끝 |
| `secondary` | `#006947` | 성공, 긍정 지표 |
| `tertiary` | `#0057bd` | 보조 정보 |
| `surface` | `#f5f7f9` | 페이지 배경 |
| `surface-container-low` | `#eef1f3` | 섹션 레이어 |
| `surface-container-lowest` | `#ffffff` | 카드 최상단 |
| `on-surface` | `#2c2f31` | 주요 텍스트 |
| `on-surface-variant` | `#595c5e` | 보조 텍스트 |

### Dark Mode
| 토큰 | 값 | 용도 |
|---|---|---|
| `surface` | `#0f1117` | 페이지 배경 |
| `surface-container-low` | `#1a1d27` | 섹션 레이어 |
| `surface-container-lowest` | `#12141e` | 카드 최하단 |
| 카드 배경 | `white/10 + backdrop-blur-xl` | 글래스 카드 |
| 텍스트 | `slate-100` / `slate-400` | 주요 / 보조 |
| Primary | `#8083ff` | 다크모드 강조 |

### 배경 Gradient
```
Light: linear-gradient(135deg, #f8fafc 0%, #eef2ff 35%, #e0f2fe 65%, #f8fafc 100%)
       + blob: indigo-100/50, sky-100/40, violet-100/30

Dark:  linear-gradient(135deg, #0f1117 0%, #13152b 40%, #0e1a2e 70%, #0f1117 100%)
       + blob: indigo-900/30, blue-900/20, purple-900/20
```

---

## 테마 시스템

- Tailwind v4 (`@import "tailwindcss"`) — `@theme` 블록으로 토큰 정의
- `darkMode: 'class'` — `document.documentElement`에 `dark` 클래스 토글
- 기본값: **다크 모드** (`localStorage` 없으면 dark)
- 저장: `localStorage.setItem('theme', 'dark' | 'light')`
- FOUC 방지: `index.html <head>`에 인라인 스크립트

```html
<script>
  const t = localStorage.getItem('theme') ?? 'dark';
  document.documentElement.classList.toggle('dark', t === 'dark');
</script>
```

---

## 레이아웃 구조

### 사이드바
- **현재**: `bg-slate-900/95` 다크 고정, 하단 Admin User + Settings 버튼
- **변경**: 라이트/다크 분기 glass (`bg-white/60 dark:bg-slate-900/80 backdrop-blur-xl`)
- 하단 Admin User + Settings 버튼 **제거**
- 메뉴 4개 유지: Dashboard / Standardization / Generation / Evaluation

### 헤더
- **현재**: 알림 벨만 있음
- **추가**: 라이트/다크 토글 버튼 (Sun ↔ Moon), 프로필 아바타 버튼
- 프로필 클릭 → Settings 탭으로 전환 (사이드바 Settings 대체)

---

## 현재 구현 상태

| 항목 | 파일 | 상태 |
|---|---|---|
| 배경 gradient + blob (라이트) | `App.tsx` | ✅ 적용됨 |
| 다크모드 gradient | `App.tsx` | ❌ 미적용 |
| Manrope 폰트 import | `index.html` | ❌ |
| FOUC 방지 스크립트 | `index.html` | ❌ |
| Tailwind `@theme` 색상 토큰 | `index.css` | ❌ (`@import "tailwindcss"` 한 줄뿐) |
| theme 상태 + 토글 | `App.tsx` | ❌ |
| Sidebar glass 스타일 | `Sidebar.tsx` | ❌ (다크 고정) |
| Sidebar 하단 Admin 제거 | `Sidebar.tsx` | ❌ |
| Header 다크토글 + 프로필 | `Header.tsx` | ❌ |
| 공통 컴포넌트 (Glass Card 등) | `components/ui/` | ❌ 폴더 없음 |
| 페이지별 적용 | 각 패널 | ❌ |

---

## Phase 1 — 글로벌 기반 ← 시작점

### 작업 목록

**`frontend/index.html`**
- Manrope 폰트 Google Fonts import
- 다크모드 FOUC 방지 인라인 스크립트

**`frontend/src/index.css`**
- `@import "@fontsource/manrope"` 또는 Google Fonts CDN
- `@theme` 블록: 색상 토큰 (`--color-primary`, `--color-surface` 등)
- `darkMode: 'class'` 설정 (Tailwind v4: `@variant dark (&:where(.dark, .dark *))`)
- body 기본 font-family: Manrope

**`frontend/src/App.tsx`**
- `theme` 상태 추가 (`'light' | 'dark'`)
- 초기값: `localStorage.getItem('theme') ?? 'dark'`
- 토글 시 `document.documentElement.classList` 제어 + localStorage 저장
- `setTheme` prop을 Header로 전달
- 다크모드 배경 gradient 분기 추가

---

## Phase 2 — 레이아웃 셸

### 작업 목록

**`frontend/src/components/layout/Sidebar.tsx`**
- `bg-slate-900/95` → `bg-white/60 dark:bg-slate-900/80 backdrop-blur-xl`
- 하단 Admin User + Settings 버튼 블록 제거
- 메뉴 active 스타일: `border` 제거 → 배경색 차이로 대체

**`frontend/src/components/layout/Header.tsx`**
- `theme` + `setTheme` prop 수신
- Sun/Moon 아이콘 토글 버튼 추가
- 프로필 아바타 버튼 추가 → `onProfileClick` 콜백으로 Settings 탭 전환
- 다크모드 헤더 배경 분기

**`frontend/src/App.tsx`**
- Header에 `theme`, `setTheme`, `onProfileClick` 전달
- `onProfileClick`: `setActiveTab("settings")` 호출

---

## Phase 3 — 공통 컴포넌트

위치: `frontend/src/components/ui/`

| 컴포넌트 | 파일 | 스펙 |
|---|---|---|
| GlassCard | `GlassCard.tsx` | `bg-white/70 dark:bg-white/10 backdrop-blur-xl rounded-3xl` + ambient shadow |
| PrimaryButton | `Button.tsx` | `rounded-full bg-gradient-to-r from-[#4647d3] to-[#9396ff]` |
| SecondaryButton | `Button.tsx` | `rounded-full bg-white/40 dark:bg-white/10 backdrop-blur-sm` |
| InputField | `Input.tsx` | `bg-white/50 dark:bg-white/5 rounded-xl` + ghost border on focus |
| Badge | `Badge.tsx` | `rounded-full` + color token 기반 |

---

## Phase 4 — 페이지별 적용

순서: **Dashboard → Standardization → Generation → Evaluation → Settings**

### Dashboard (`DashboardOverview.tsx`, `StatsCards.tsx`, `ActivityChart.tsx`)
- `StatsCards`: `bg-white/80 + border-l-4` → GlassCard + border 제거, accent를 아이콘 색으로
- 차트 배경 투명화
- Quick Action 버튼 → PrimaryButton / SecondaryButton

### Standardization (`DataStandardizationPanel.tsx`, `HierarchyConstructionPanel.tsx`)
- 업로드 영역 → glass + dashed border 유지 (radius 강화)
- 계층 트리 레벨 구분 → border 제거, 배경색 tonal layering

### Generation (`QAGenerationPanel.tsx`)
- `.improved.tsx` 버전 확인 후 기준 파일 결정 (현재 두 버전 존재)
- 설정 패널 → GlassCard
- 모델 선택 드롭다운 → InputField 스타일
- 진행상태 바 → primary gradient

### Evaluation (`QAEvaluationDashboard.tsx`)
- 테이블 행 hover → glass tint
- 점수 뱃지 → Badge 컴포넌트 (color token 기반)
- 차트 배경 투명화

### Settings (`SettingsPanel.tsx`, `PipelineFlow.tsx`)
- API Keys 탭 → InputField + GlassCard
- 프로필 탭 → GlassCard
- Pipeline Flow 탭 유지

---

## 기술 주의사항

### Tailwind v4 호환
- `tailwind.config.js` **없음** — `index.css`의 `@theme` 블록으로 토큰 정의
- `darkMode` 설정: v4에서는 CSS에서 `@custom-variant dark (&:where(.dark *));` 방식
- `backdrop-blur`, `bg-white/70` 등 유틸리티는 v4에서 동일하게 동작

### 주의할 파일
- `QAGenerationPanel.tsx` vs `QAGenerationPanel.improved.tsx` — Phase 4 진행 전 정리 필요
- `components/agents/AgentTable.tsx`, `components/analytics/AnalyticsDashboard.tsx` — 현재 라우팅에 없는 미사용 파일, Phase 4에서 제외

---

## 참고 파일
- `test/uidesign/ui_sample1.webp` — 따뜻한 earthy glass 대시보드
- `test/uidesign/ui_sample2.webp` — 클린 라이트 모드, 헤더 프로필 패턴
- `test/uidesign/ui_sample3.webp` — 다크 모드 레퍼런스
- `test/uidesign/ui_sample4/DESIGN.md` — 색상 토큰·컴포넌트 스펙 (주 레퍼런스)
- `test/uidesign/ui_sample4/code.html` — 실제 구현 HTML 레퍼런스
