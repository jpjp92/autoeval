# 모바일 UI 개선 기획 (2026-11-12)

> 상태: 진행 중 (브랜치 `dev`). 다국어 문서 처리 개선은 이 문서 범위에서 제외하고 별도 기획으로 다룬다.
> 근거: iPhone Safari 스크린샷 17장(2026-11-10), GPT 검토 지시서, 현재 소스 대조.

## 1. 문제

375px 화면에서 카드 본문에 남는 폭이 약 159px이다.

| 차지하는 요소 | 폭 |
| --- | ---: |
| 사이드바 (접힌 상태 `w-[84px]`) | 84px |
| main 좌우 패딩 `px-4` | 32px |
| StepCard 왼쪽 세로 타임라인 (원 32px + 간격 20px) | 52px |
| StepCard 본문 패딩 `p-6` | 48px |
| **카드 본문** | **약 159px** |

이 폭에 버튼 최소폭 `min-w-[148px]`, 3열 지표 grid, 계층 트리 들여쓰기가 들어가면서 글자가 한두 글자씩 줄바꿈된다.
StepCard 본문(`flex-1`)과 App 콘텐츠 영역에 `min-w-0`가 없어 긴 내용이 화면 밖으로 밀린다.

화면별 증상:

- Documents: 등록 완료 카드, 카테고리 분류 진행, 분류 미리보기, H1/H2/H3 트리가 잘리거나 세로로 길어진다.
- QA Pipeline: 모델 선택이 `Gemini 3...`로 잘리고, 진행률과 취소 버튼이 좁은 칸에 몰리고, QA 미리보기가 매우 길어진다.
- Header: 알림 팝오버(`absolute right-0 w-80`)의 왼쪽이 화면 밖으로 잘린다.
- Evaluation: KPI가 1열이라 화면이 길고, 상세 결과 표는 가로 스크롤로 잘린다.
- 공통: 뷰포트 설정에 `viewportFit: 'cover'`가 없어 safe-area 값이 0이고, iOS 하단 툴바와 콘텐츠가 겹친다.

## 2. 결정 사항

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 모바일 내비게이션 | 하단 탭바 (Dashboard / Documents / QA Pipeline / Evaluation) | 메뉴가 4개이고 화면 간 이동이 잦다. 햄버거 드로어와 비교한 샘플을 보고 결정 |
| Settings, 테마 | 헤더 더보기(⋮) 메뉴 | 탭바에는 주요 화면 4개만 둔다 |
| 기준 너비 | `lg`(1024px) 미만을 모바일로 처리 | 기존 코드와 Sidebar 자동 접힘이 이미 1023px 기준 |
| 데스크톱 | 변경 없음 | `lg` 이상은 기존 Sidebar와 레이아웃 유지 |
| 탭 상태 보존 | 기존 `hidden` 상시 마운트 방식 유지 | Shell만 바꾸므로 polling과 진행 상태가 그대로 보존된다 |
| E2E | `@playwright/test` 1.64.1 devDependency 추가 | 뷰포트 가로 넘침 자동 검사 |
| 작업 브랜치 | `dev` (main을 fast-forward로 반영한 상태에서 시작) | |

## 3. 작업 단위

각 단위는 별도 커밋으로 나눈다.

### M0. App Shell과 하단 탭바 (P0)

- `lg` 미만에서 Sidebar를 렌더링하지 않고 `MobileTabBar`를 표시한다.
- 탭 버튼은 아이콘과 라벨, 44px 이상 터치 영역, `aria-current="page"`를 갖는다.
- 루트를 `h-[100dvh]`로 바꾸고 콘텐츠 영역에 `min-w-0`를 준다.
- `app/layout.tsx`에 `viewport` export(`viewportFit: 'cover'`)를 추가하고, 탭바 하단에 `env(safe-area-inset-bottom)` 여백을 둔다.
- 헤더: 모바일 패딩 축소, Settings와 테마 전환을 더보기 메뉴로 이동.
- 알림 팝오버: 폭을 `min(20rem, 100vw - 24px)`로 제한한다.

### M1. 공용 StepCard (P0)

- `QAGenerationPanel.tsx`, `DataStandardizationPanel.tsx`에 따로 있는 StepCard를 `components/common/StepCard.tsx` 하나로 합친다.
- 모바일: 왼쪽 타임라인을 숨기고 헤더에 단계 번호를 표시한다. 헤더 `px-4 py-3`, 본문 `p-4`, 본문 `min-w-0`.
- 공통 버튼 `btnBase`: 모바일 `w-full`, `sm` 이상에서만 `min-w-[148px]`.

### M2. Documents / QA Pipeline (P0)

- 등록 완료 카드: 파일명 줄임 처리, 상태 배지를 오른쪽에 분리.
- 카테고리 분석 진행: 스피너와 메시지를 한 카드 안에 세로로 배치.
- 분류 미리보기: 배지와 화살표를 `flex-wrap`으로 줄바꿈.
- 계층 트리: 모바일 들여쓰기 축소, 라벨이 단어 단위로 줄바꿈되게 한다.
- 3열 지표 grid: 모바일에서 2열.
- 생성 진행 영역: 단계명, 진행률, 완료 개수, 취소 버튼을 세로로 배치.
- QA 미리보기: 질문 2줄과 intent만 보이고 답변은 펼쳐서 본다.

### M3. Evaluation (P1)

- KPI 4개를 모바일 2열로 배치.
- 메타데이터(모델, 원천 문서, 평가 일시)를 줄바꿈 가능하게.
- History, Export 메뉴가 화면 안에서 열리게.
- 상세 평가 결과: 모바일에서 카드 목록(질문, intent, 점수, 성공/실패), 데스크톱은 기존 표 유지.

### M4. 검증과 정리 (P1)

- Playwright로 360 / 375 / 390 / 430 / 1024 / 1440px에서 탭별 `scrollWidth <= innerWidth` 검사.
- 1023px 이하 글꼴 축소(`index.css`) 폭을 레이아웃 정상화 후 재검토.
- 라이트/다크 테마 대비, 포커스 표시, Escape로 메뉴 닫기 확인.
- iPhone Safari 실기기 확인은 사용자가 수행한다.

## 4. 완료 기준

- 360~430px에서 Documents, QA Pipeline, Evaluation 화면에 가로 넘침과 글자 잘림이 없다.
- 탭 이동 후 돌아와도 진행 중 작업, 설정, 입력값이 유지된다.
- iOS 하단 툴바와 탭바, 버튼이 겹치지 않는다.
- 1024px 이상 데스크톱 화면은 기존과 같다.
- `npm run lint`, `npm run build`, `npm run test:proxy`, Playwright 검사가 통과한다.

## 5. 범위 밖

- 영문/다국어 문서 파싱, 청킹, QA 언어 정책 (GPT 지시서 L0~L6). 스크린샷 16의 영문 PDF 컨텍스트는 띄어쓰기가 정상이라, 영문 PDF 샘플로 문제를 먼저 확인한 뒤 별도 기획한다.
- 백엔드 API, DB, 배포 설정 변경.
