# 모바일 UI 후속 개선 기획 (2026-11-14)

> 상태: F1·F2·F3(b)·샘플 수 버그 구현 완료 (2026-11-14, 브랜치 `dev`). 결과는 [DEV_261114.md](../History/DEV_261114.md). 글꼴, 태블릿, next-env 소유권은 남음. 1차 작업은 [PLAN_261112_MOBILE_UI.md](PLAN_261112_MOBILE_UI.md), 결과는 [DEV_261112.md](../History/DEV_261112.md) (PR #2로 main 반영, iPhone 실기기 확인 완료).
> 근거: 1차 작업의 남은 일, GPT 검토(모바일 Settings 토글 UX), 현재 소스 대조.

## 1. 현재 구조 (소스 확인)

- 화면 전환은 `App.tsx`의 `activeTab` state 하나로 한다. URL, `history.pushState`, `popstate`를 쓰지 않는다.
  그래서 브라우저 뒤로 가기는 앱 밖(이전 사이트)으로 나간다. 이번 작업 전부터 그랬다.
- 탭은 `hidden`으로 항상 마운트되어 입력값과 진행 상태는 유지된다.
- 스크롤 컨테이너는 `main` 하나를 모든 탭이 같이 쓴다. 탭을 바꿔도 `scrollTop`이 그대로 남아,
  돌아오면 이전 위치가 아니라 직전 탭의 위치(또는 잘린 값)가 된다. 탭별 스크롤은 지금 보존되지 않는다.
- 모바일 Settings 버튼(`Header.tsx`, `lg:hidden`)은 항상 톱니 아이콘이고 누르면 `settings`로 이동만 한다.
  다시 눌러도 그대로 Settings다. 데스크톱은 Sidebar의 Settings 항목으로 이동한다.

## 2. 작업 단위

### F1. Settings 토글 (P0)

| 사용자 행동 | 동작 |
| --- | --- |
| 일반 탭에서 톱니 버튼 | Settings 진입, 직전 탭을 복귀 대상으로 저장 |
| Settings에서 같은 버튼 | 복귀 대상 탭으로 이동 |
| Settings에서 하단 탭 선택 | 그 탭으로 이동, 이후 복귀 대상도 그 탭 |
| Dashboard의 파이프라인 카드 → Settings | 같은 규칙(Dashboard로 복귀) |

- `App.tsx`에 `lastMainTab` state(`overview | standardization | generation | evaluation`, 초깃값 `overview`)를 둔다.
  `setActiveTab`을 감싼 `navigate(tab)`에서 `tab !== 'settings'`일 때만 갱신한다.
  복귀 대상이 `settings`로 기록될 수 없으므로 연타·빠른 전환 문제도 함께 막힌다.
- Header 버튼: Settings 활성 시 `ArrowLeft` 아이콘, `aria-label`/`title`은 "이전 화면으로 돌아가기",
  평소에는 `Settings` 아이콘과 "설정 열기". `aria-current`는 제거(이제 이동 버튼이 아니라 토글).
- 데스크톱 Sidebar 동작은 바꾸지 않는다.

### F2. 탭별 스크롤 위치 보존 (P1)

- `navigate` 직전에 `main.scrollTop`을 탭별로 저장하고, 전환 후 `useLayoutEffect`에서 복원한다.
- F1의 "기존 탭 스크롤 위치 보존" 요구가 현재 구조에서는 충족되지 않아서 별도 단위로 둔다.

### F3. 브라우저 뒤로 가기 (P2, 결정 필요)

- 선택지
  - (a) 현행 유지: 뒤로 가기는 앱을 떠난다. 변경 없음.
  - (b) Settings 진입 시에만 `pushState`, `popstate`에서 복귀 대상으로 이동. Settings가 보조 화면이라는 성격과 맞는다.
  - (c) 모든 탭 전환을 히스토리에 기록(`?tab=` 또는 hash). 새로고침·링크 공유까지 되지만 변경 범위가 크다.
- 권장: (b). 범위가 작고 모바일에서 "뒤로 가기 = Settings 닫기"가 자연스럽다. 탭 전환 전체는 다루지 않는다.

### F4. 1차 작업의 남은 일

- "청크 샘플 수" 입력 버그(P0): `QAGenerationPanel`의 `sampleInputValue` 초깃값 `""`, `formValues.samples` 초깃값 2.
  화면은 빈칸인데 2로 생성된다. 초깃값을 `"2"`(또는 `String(formValues.samples)`)로 맞춘다.
- 1023px 이하 글꼴 축소(`index.css`, 11~14px) 재검토(P1): 실기기 기준으로 축소 폭을 줄일지 정한다.
- 768~1023px 태블릿(P2): 하단 탭바와 데스크톱형 2열 레이아웃이 섞이는 구간 확인.
- Docker 개발 컨테이너가 `frontend/next-env.d.ts`를 root 소유로 만드는 문제(P2): compose에 `user` 지정 검토.

## 3. 검증

- Playwright `mobile-layout.spec.ts`에 추가
  - 각 일반 탭 → 톱니 → 같은 버튼으로 원래 탭 복귀, 아이콘/`aria-label` 전환
  - Settings에서 하단 탭 선택 후 다시 톱니 → 복귀 대상 갱신
  - 연타(2~3회 빠른 클릭) 후 상태가 `settings`나 엉뚱한 탭으로 꼬이지 않음
  - F2: 스크롤 후 탭 전환·복귀 시 위치 유지
  - F3(b) 채택 시: Settings에서 `page.goBack()` → 복귀 대상 탭
- 1024 / 1440px: Sidebar Settings 이동이 기존과 같은지 회귀 확인
- `npm run lint`, `npm run build`, `npm run test:proxy`, Playwright 통과

## 4. 제약

- App Shell과 하단 탭바 디자인 유지, 데스크톱 레이아웃 변경 없음
- 백엔드 API, DB 변경 없음. 탭의 작업 진행 상태를 초기화하지 않는다.
- 최소 변경. 커밋·푸시·배포는 사용자 요청 시에만.
