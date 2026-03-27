# UI 리디자인 계획 — Luminous Clarity

> 작성일: 2026-03-27
> 레퍼런스: `test/uidesign/ui_sample1~4` / DESIGN.md ("Luminous Clarity")
> 진행 방식: Phase 1-2 완성 → Phase 3-4 진행

---

## 디자인 방향

**"Luminous Clarity"** — 글래스모피즘 + Pastel Canvas
단단한 박스 레이아웃을 탈피해 투명도·블러·여백으로 공간감을 만드는 프리미엄 SaaS 스타일.

### 핵심 원칙
- **No-Line Rule**: 1px solid border로 영역 구분 금지 → 배경색 차이(tonal layering)로 대체
- **Extra Round**: 외부 컨테이너 `rounded-3xl` (48px), 내부 요소 `rounded-xl` (24px)
- **Glassmorphism**: `bg-white/70 dark:bg-white/10 backdrop-blur-xl`
- **Ambient Shadow**: `shadow` blur 40-60px, opacity 4-8% (검정 금지 → tinted indigo-grey)
- **폰트**: Manrope (200-800 weight)

---

## 색상 토큰 (Light / Dark)

### Light Mode
| 토큰 | 값 | 용도 |
|---|---|---|
| `primary` | `#4647d3` | 주요 액션, 포커스 |
| `primary-container` | `#9396ff` | 버튼 그라디언트 끝 |
| `secondary` | `#006947` | 성공, 긍정 지표 |
| `tertiary` | `#0057bd` | 보조 정보, 인터랙티브 |
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
| 카드 배경 | `white/10` + `backdrop-blur-xl` | 글래스 카드 |
| 텍스트 | `slate-100` / `slate-400` | 주요 / 보조 |
| Primary | `#8083ff` (`inverse-primary`) | 다크모드 강조 |

### 배경 Gradient
```
Light: linear-gradient(135deg, #f8fafc 0%, #eef2ff 35%, #e0f2fe 65%, #f8fafc 100%)
       + blob: indigo-100/50, sky-100/40, violet-100/30 (3개)

Dark:  linear-gradient(135deg, #0f1117 0%, #13152b 40%, #0e1a2e 70%, #0f1117 100%)
       + blob: indigo-900/30, blue-900/20, purple-900/20 (3개)
```

---

## 테마 시스템

- `tailwind.config`: `darkMode: 'class'`
- 기본값: **다크 모드** (`localStorage` 없으면 dark 적용)
- 토글: 헤더 우측 Sun/Moon 아이콘 버튼
- 저장: `localStorage.setItem('theme', 'dark'|'light')`
- FOUC 방지: `index.html` `<head>`에 인라인 초기화 스크립트

```html
<script>
  const t = localStorage.getItem('theme') ?? 'dark';
  document.documentElement.classList.toggle('dark', t === 'dark');
</script>
```

---

## 레이아웃 구조 변경

### 사이드바
- **현재**: `bg-slate-900/95` 다크 고정
- **변경**: 라이트 글래스 (`bg-white/60 dark:bg-slate-900/80 backdrop-blur-xl`)
- 하단 Admin User + Settings 버튼 **제거**
- 메뉴: Dashboard / Standardization / Generation / Evaluation 4개 유지

### 헤더 (우측 추가)
- **알림 벨** 아이콘 버튼 (badge 숫자 옵션)
- **라이트/다크 토글** 버튼 (Sun ↔ Moon)
- **프로필 아바타** 버튼 → 클릭 시 Settings 패널로 전환
- Settings는 헤더 프로필에서만 접근 (사이드바 제거)

---

## Phase 1 — 글로벌 기반

### 작업 목록
| 파일 | 변경 내용 |
|---|---|
| `frontend/index.html` | Manrope 폰트 import + 다크모드 FOUC 방지 스크립트 |
| `frontend/tailwind.config` or `index.css` | 색상 토큰, `darkMode: 'class'`, Manrope font-family |
| `frontend/src/App.tsx` | `theme` 상태 + 배경 gradient 강화 (light/dark 분기) |

---

## Phase 2 — 레이아웃 셸

### 작업 목록
| 파일 | 변경 내용 |
|---|---|
| `frontend/src/components/layout/Sidebar.tsx` | 다크 → 라이트 glass 스타일, 하단 Settings 제거 |
| `frontend/src/components/layout/Header.tsx` | 알림 벨 + 다크/라이트 토글 + 프로필 아바타 추가, Settings 연결 |
| `frontend/src/App.tsx` | `theme` prop 전파, 프로필 클릭 → settings 탭 전환 |

---

## Phase 3 — 공통 컴포넌트

| 컴포넌트 | 스펙 |
|---|---|
| Glass Card | `bg-white/70 dark:bg-white/10 backdrop-blur-xl rounded-3xl` + ambient shadow |
| Primary Button | `rounded-full bg-gradient-to-r from-[#4647d3] to-[#9396ff] text-white` |
| Secondary Button | `rounded-full bg-white/40 dark:bg-white/10 backdrop-blur-sm` |
| Input Field | `bg-white/50 dark:bg-white/5 rounded-xl` + ghost border on focus |
| Badge/Tag | `rounded-full` + color token 기반 |
| Section Header | Manrope `font-bold text-xl tracking-tight` |

---

## Phase 4 — 페이지별 적용

진행 순서: **Dashboard → Standardization → Generation → Evaluation → Settings**

### Dashboard
- 지표 카드 4개 → Glass Card 적용
- 차트 배경 투명화
- Quick Action 버튼 → Primary/Secondary 버튼 통일

### Standardization
- 업로드 영역 → glass + dashed border 유지 (단, radius 강화)
- 계층 트리 → 배경색 차이로 레벨 구분 (border 제거)

### Generation
- 설정 패널 → glass card
- 모델 선택 드롭다운 → 통일된 input 스타일
- 진행상태 바 → primary gradient

### Evaluation
- 테이블 → 행 hover 시 glass tint
- 점수 뱃지 → color token 기반 rounded-full
- 차트 배경 투명화

### Settings (헤더 프로필 연결)
- Pipeline Flow 탭 유지
- API Keys 탭 → glass card input 스타일
- 프로필 탭 → glass card

---

## 참고 파일
- `test/uidesign/ui_sample1.webp` — 따뜻한 earthy glass 대시보드
- `test/uidesign/ui_sample2.webp` — 클린 라이트 모드, 헤더 프로필 패턴
- `test/uidesign/ui_sample3.webp` — 다크 모드 레퍼런스
- `test/uidesign/ui_sample4/DESIGN.md` — 색상 토큰·컴포넌트 스펙 (주 레퍼런스)
- `test/uidesign/ui_sample4/code.html` — 실제 구현 HTML 레퍼런스
