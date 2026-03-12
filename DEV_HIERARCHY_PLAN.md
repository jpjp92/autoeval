# Hierarchy 기반 QA 생성/평가 계획

## 현황

- **데이터 소스**: `ref/data/data_2026-03-06_normalized.json` (1,106개 문서)
- **계층 참고**: `ref/data/representative_hierarchies.json`, `ref/data/hierarchy_status.json`

### 계층 구조

| 레벨 | 고유값 수 | 비고 |
|---|---|---|
| Level 1 | **5개** | Shop / 고객지원 / 마이 / 상품 / 혜택 |
| Level 2 | **30개** | 모바일, TV, 로밍, 공지이용안내 등 |
| Level 3 | **108개** | 요금제, 핸드폰, 부가서비스 등 → UI에서 검색+선택 |
| Level 4+ | 수백개+ | 세분화 과도 → 선택 UI 제외 (필터링만) |

---

### Phase 1: Hierarchy 선택 UI (프론트엔드)

### 목표
Data Generation 페이지 우측의 `Target Hierarchy` 카드를 단순 표시용에서 **문서 탐색 및 선택이 가능한 'Searchable Hierarchy Navigator'**로 개편합니다.

### UI 구성 (Searchable Navigator)

오른쪽 사이드바 영역을 다음과 같이 재구성합니다:

1. **Category Tabs (Level 1 & 2)**
   - 대분류(Shop, 상품 등)를 탭 형태로 상단 배치하여 빠른 전환 유도.
   - 중분류(Level 2)는 가로 스크롤 칩(Chip) 또는 서브 메뉴로 구성.
2. **Search & Multi-Select (Level 3)**
   - Level 3(108개)를 위한 검색 바(Search Bar) 기본 장착.
   - 검색 결과에 따른 체크박스 리스트 표시.
3. **Real-time Stat Badges**
   - 계층명 옆에 `(미사용/전체)` 문서 수를 배지로 표시하여 실시간 데이터 가시성 확보.
   - 예: `요금제 (12 / 48)` - 48개 중 12개 미사용.

### 컴포넌트 상세

```
HierarchyNavigator (Right Sidebar)
├─ Header
│   └─ Title: "Target Hierarchy Selection"
├─ Level1&2_SegmentControl -- 탭/칩 형태의 대/중분류 선택기
├─ FilterSection
│   ├─ SearchInput -- Level 3 검색용
│   └─ QuickFilter -- "미사용 문서만 보기" 토글
├─ Scrollable_CheckboxList (Level 3)
│   └─ Item: {Checkbox} {Title} {StatusBadge (M/N)}
├─ Sampling_Control_Panel -- 하단 고정 영역
│   ├─ Stratified_Toggle -- "균형 샘플링 ★권장" 리액티브 버튼
│   └─ Selected_Selection_Summary -- "선택된 범위: 5개 카테고리 / 120개 문서"
└─ Action_Buttons
    └─ Reset_Usage_History -- "이 범위 사용 이력 초기화" (관리자용)
```

### UI/UX Aesthetic Detail (Theme Options)

사용자의 취향이나 서비스 컨셉에 따라 두 가지 프리미엄 스타일을 제안합니다.

#### Option A: Glassmorp (Soft & Techy) 
- 공유 레퍼런스 [Demo](https://tailwinddashboard.com/demo/?demo=glassmorp) 반영.
- **Visuals**: `backdrop-filter: blur(10px)`, 반투명 유리 질감, 부드러운 그라데이션 배경.
- **Feel**: 미래지향적, 세련됨, 가볍고 공중에 떠 있는 느낌.

#### Option B: Neo Brutalism (Bold & Clear) 
- 공유 레퍼런스 [Demo](https://tailwinddashboard.com/demo/?demo=brutalism) 반영.
- **Visuals**: 
  - `border: 2px solid #000` (모든 패널/버튼에 두꺼운 테두리)
  - `box-shadow: 4px 4px 0px 0px #000` (부드러운 블러가 없는 딱딱한 그림자)
  - 고대비 단색 배경 및 굵은 선 중심의 아이콘.
- **Feel**: 힙하고 트렌디함, 데이터의 명확성 강조, 강력한 도구(Tool) 느낌.

---

## Phase 2: Hierarchy 필터링 — 백엔드 연동

### API 변경

#### `POST /api/generate` 요청 바디 추가 필드
```json
{
  "model": "gemini-3.1-flash",
  "lang": "ko",
  "samples": 10,
  "prompt_version": "v1",
  "hierarchy_filter": {
    "level1": "상품",
    "level2": "모바일",
    "level3": ["요금제", "5G", "LTE"]
  }
}
```

#### `generation_api.py` 변경

```python
# run_qa_generation_real() 내 items 로딩 시점에 필터 적용
def _filter_by_hierarchy(items, level1=None, level2=None, level3=None):
    """
    각 item의 hierarchy 필드 기준으로 필터링
    item["hierarchy"] = "상품 > 모바일 > 요금제 > 5G > ..."
    """
    filtered = items
    if level1:
        filtered = [i for i in filtered if i.get("hierarchy", "").startswith(level1)]
    if level2:
        filtered = [i for i in filtered if f"> {level2}" in i.get("hierarchy", "")]
    if level3:
        filtered = [i for i in filtered if any(f"> {l3}" in i.get("hierarchy", "") for l3 in level3)]
    return filtered
```

#### `GenerateRequest` 모델 확장
```python
class HierarchyFilter(BaseModel):
    level1: Optional[str] = None
    level2: Optional[str] = None
    level3: Optional[List[str]] = None

class GenerateRequest(BaseModel):
    model: str = "gemini-3.1-flash"
    lang: str = "ko"
    samples: int = 10
    qa_per_doc: Optional[int] = None
    prompt_version: str = "v1"
    hierarchy_filter: Optional[HierarchyFilter] = None  # 추가
```

---

## 샘플링 전략 상세

### 문제: 순수 랜덤의 중복 선택

순수 랜덤으로 매번 샘플링하면 이전에 생성/평가했던 **동일 문서가 다시 선택**될 수 있음.

```
1차 생성: [doc_001, doc_015, doc_032, doc_087]
2차 생성: [doc_015, doc_032, doc_047, doc_099]  ← doc_015, doc_032 중복!
```

**중복 선택의 문제**
- API 호출 비용 중복
- 평가 결과 편향 (같은 문서 반복 영향)
- 전체 계층 커버리지 저하

---

### 해결: docId 기반 중복 제외

Supabase `qa_generation` 테이블에 저장된 이전 생성 이력의 `docId`를 조회하여 제외.

```
신규 생성 요청 (Level2=모바일, samples=4)
    ↓
Supabase에서 해당 hierarchy의 기존 사용 docId 조회
    ↓
전체 문서 pool (203개) - 기존 사용 docId (예: 48개) = 미사용 pool (155개)
    ↓
미사용 pool에서 균형 샘플링 → 4개 선택
```

#### 케이스별 처리

| 상황 | 동작 |
|---|---|
| 미사용 문서 ≥ samples | 미사용에서만 샘플링 |
| 미사용 문서 < samples | 미사용 우선 + 기존 문서 보충 + ⚠️ 경고 표시 |
| 미사용 문서 = 0 | "이 범위 문서 소진" 알림 + 초기화 옵션 제공 |

---

### 균형 샘플링 (Stratified) — 기본값

Level3 없이 Level2만 선택했을 때, 하위 Level3별로 균등하게 샘플링.
순수 랜덤보다 다양성이 보장됨.

```python
import random
from collections import defaultdict

def _stratified_sample(items, n, exclude_doc_ids=None):
    """
    Level3 기준 균형 샘플링 + docId 중복 제외
    """
    exclude_doc_ids = set(exclude_doc_ids or [])

    # 미사용 문서 필터
    available = [i for i in items if i.get("docId") not in exclude_doc_ids]

    # 부족 시 경고 후 기존 문서 보충
    if len(available) < n:
        shortage = n - len(available)
        used = [i for i in items if i.get("docId") in exclude_doc_ids]
        available += random.sample(used, min(shortage, len(used)))

    # Level3 기준 그룹화
    groups = defaultdict(list)
    for item in available:
        parts = item.get("hierarchy", "").split(" > ")
        l3 = parts[2] if len(parts) > 2 else "기타"
        groups[l3].append(item)

    # 라운드로빈: 각 Level3에서 1개씩 순환
    result, keys = [], list(groups.keys())
    random.shuffle(keys)
    while len(result) < n:
        for k in keys:
            if groups[k] and len(result) < n:
                item = random.choice(groups[k])
                groups[k].remove(item)
                result.append(item)

    return result
```

---

### 프론트 UI 반영

- Hierarchy 선택 시 **"전체 N개 / 미사용 M개"** 실시간 표시
- 미사용 문서 0개 시 경고 배지 + "초기화" 버튼
- 샘플링 모드 토글: `균형 샘플링 ★권장` / `순수 랜덤`

---


### 목표
Hierarchy 필터가 적용된 생성 결과를 평가할 때도 동일 필터 정보를 추적하여
"어떤 계층의 QA가 품질이 낮은지" 분석 가능하게 함.

### Supabase 저장 구조 (기존 `qa_generation` 테이블 `hierarchy` 컬럼 활용)
```json
{
  "hierarchy": {
    "sampling": "hierarchy",
    "level1": "상품",
    "level2": "모바일",
    "level3": ["요금제", "5G"],
    "filtered_document_count": 48
  }
}
```

### 평가 결과에 hierarchy 태그 추가
- `evaluation_results` 테이블에 `hierarchy_filter` 컬럼 추가 (optional)
- 향후 "카테고리별 QA 품질 대시보드" 구현 가능

---

## 구현 순서

### Sprint 1 (프론트)
- [ ] `GET /api/hierarchy` 엔드포인트 — Level 1/2/3 데이터 반환
- [ ] `GET /api/hierarchy/usage` 엔드포인트 — 계층별 미사용 docId 수 반환
- [ ] `HierarchySelector` 컴포넌트 구현 (드릴다운 + 검색)
- [ ] 미사용 문서 수 배지 (`전체 N개 / 미사용 M개`) 표시
- [ ] 샘플링 모드 토글 (균형 / 랜덤)
- [ ] Data Generation 페이지에 통합

### Sprint 2 (백엔드)
- [ ] `GenerateRequest`에 `hierarchy_filter` 필드 추가
- [ ] `_filter_by_hierarchy()` 유틸 함수 구현
- [ ] `_stratified_sample()` 균형 샘플링 + docId 중복 제외
- [ ] Supabase에서 기존 사용 docId 조회 (`get_used_doc_ids()`)
- [ ] `run_qa_generation_real()` 내 필터+샘플링 적용
- [ ] Supabase `hierarchy` 컬럼에 필터 + 사용 docId 저장

### Sprint 3 (평가 연동)
- [ ] 평가 시 hierarchy context 전달
- [ ] 카테고리별 평가 점수 집계
- [ ] 대시보드: 계층별 QA 품질 시각화

---

## 참고: 계층 데이터 API 응답 설계

### `GET /api/hierarchy`
```json
{
  "level1": ["Shop", "고객지원", "마이", "상품", "혜택"],
  "level2_by_level1": {
    "상품": [
      { "name": "모바일", "count": 203 },
      { "name": "TV", "count": 162 },
      ...
    ]
  },
  "level3_by_level2": {
    "모바일": ["요금제", "부가서비스", "스마트 워치", ...],
    "TV": ["지니TV셋톱박스", "VOD", ...]
  }
}
```

이 데이터는 `representative_hierarchies.json`을 파싱해서 반환하거나,
`hierarchy_status.json`의 `by_level` 섹션을 활용.
