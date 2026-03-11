# 데이터 파이프라인 검증 보고서

**검증일:** 2026-03-06
**검증 방법:** 직접 코드 실행 (uv run python3)
**검증 대상:** `ref/data/` 전체

---

## 1. 실제 파이프라인 구조

```
scraped_results/        →  preprocessed_results/  →  formatted_results/  →  data_2025-10-31_092604.json
(원시 크롤링 결과)           (정제된 마크다운)           (구조화 개별 JSON)        ★ 최종 통합본
5,525개 파일               4,426개 파일               1,106개 파일             12.54 MB
(.html / .md / .json)      (.md / .txt)               (.json)                1,106개 배열
```

> **핵심:** `data_2025-10-31_092604.json`은 formatted_results 1,106개 개별 JSON을 하나의 배열로 합친 **최종 통합본**이다.

---

## 2. 각 단계 상세

### Stage 1: scraped_results

- 원시 HTML 크롤링 결과
- 파일 구성: `html.html`, `markdown.md`, `meta.json`, `url.txt`, `mobile_url.txt` (노드당 5개)
- 링크, 이미지 alt 텍스트, javascript 코드 등 포함된 원본 상태

### Stage 2: preprocessed_results

- scraped에서 링크·이미지 등 제거한 정제 마크다운
- 파일 구성: `original.md`, `processed.md`, `url.txt`, `mobile_url.txt` (노드당)
- `processed.md` 내용 = 통합본 JSON `text` 필드와 **완전 동일** (언이스케이프 기준)

### Stage 3: formatted_results

- preprocessed의 내용을 JSON 구조로 재구성 + 폴더 계층화
- 파일 구성: `{페이지명}.json` 1개 (노드당)
- `text` 필드 = `processed.md`를 JSON 문자열 직렬화 (`\n` → `\\n`)

### 최종: data_2025-10-31_092604.json

- formatted_results 1,106개 JSON을 하나의 JSON 배열로 통합
- **text 완전 일치 검증: 1,106/1,106개 (0개 불일치)**
- 인코딩: **UTF-8 BOM** → 반드시 `encoding='utf-8-sig'` 으로 로드해야 함

---

## 3. 통합본 데이터 구조

```json
[
  {
    "docId":     "ktcom_3842",
    "url":       "https://shop.kt.com/...",
    "murl":      "https://m.shop.kt.com/...",
    "hierarchy": ["Shop", "USIMeSIM 가입", "선불 USIM 구매충전"],
    "title":     "선불 USIM 구매충전",
    "text":      "마크다운 본문 (\\n 이스케이프됨)",
    "startdate": "0000-00-00",
    "enddate":   "9999-99-99",
    "metadata":  { "images": [...], "urls": [...] },
    "status":    "unchanged"
  },
  ...
]
```

---

## 4. 실측 통계

| 항목       | 값                        |
| ---------- | ------------------------- |
| 총 항목 수 | 1,106개                   |
| 파일 크기  | 12.54 MB                  |
| 인코딩     | UTF-8 BOM (`utf-8-sig`) |
| 고유 docId | 1,106개 (중복 없음)       |

### 대분류 분포

| 대분류   | 항목 수 | 비율  |
| -------- | ------- | ----- |
| 상품     | 536     | 48.5% |
| 고객지원 | 302     | 27.3% |
| Shop     | 168     | 15.2% |
| 혜택     | 99      | 8.9%  |
| 마이     | 1       | 0.1%  |

### 계층 깊이 분포

| 깊이  | 항목 수 | 비율  |
| ----- | ------- | ----- |
| 1단계 | 2       | 0.2%  |
| 2단계 | 3       | 0.3%  |
| 3단계 | 67      | 6.1%  |
| 4단계 | 453     | 41.0% |
| 5단계 | 439     | 39.7% |
| 6단계 | 102     | 9.2%  |
| 7단계 | 40      | 3.6%  |

---

## 5. hierarchy 노드명 공백 차이 분석

### 전수 검사 결과 (공백 제거 후 동일한 노드명)

| 노드명 A (공백 있음) | 노드명 B (공백 없음) | URL 겹침 | 판정 |
|---|---|---|---|
| `USIMeSIM 가입` (4개) | `USIMeSIM가입` (5개) | 없음 | ⚠️ 별개 URL이지만 **동일 카테고리 분리** |
| `요고 다이렉트` (5개) | `요고다이렉트` (1개) | 없음 | ⚠️ 별개 URL이지만 **동일 카테고리 분리** |
| `선불 USIM 구매충전` (1개) | `선불USIM구매충전` (1개) | 없음 | ⚠️ 기능 동일, URL만 다름 (구/신 경로) |
| `갤럭시 브랜드관` (1개) | `갤럭시브랜드관` (1개) | **1개** | ❌ 완전 중복 (동일 URL, 다른 경로) |
| `프리미엄급 인터넷` (1개) | `프리미엄급인터넷` (1개) | 없음 | ✅ 실제 다른 페이지 |

---

### USIMeSIM 가입 / USIMeSIM가입 상세

실제 웹사이트(kt.com > Shop) 메뉴: **"USIM/eSIM/자급제"** 하나의 카테고리

데이터에서는 크롤링 과정에 두 노드로 분리됨:

```
Shop > USIMeSIM 가입 (공백 있음)          Shop > USIMeSIM가입 (공백 없음)
 ├─ 선불 USIM 구매충전                      ├─ eSIM이동
 └─ 휴대폰 요금제 가입                      ├─ 데이터쉐어링가입
      ├─ USIM 가입                           ├─ 듀얼번호가입
      ├─ USIM 구매                           ├─ 선불USIM구매충전   ← URL 다름!
      └─ eSIM 가입                           └─ 스마트기기요금제가입
```

**"선불 USIM 구매충전" 중복 상세:**
- A: `shop.kt.com/wireless/mobileList.do?category=usim` (구 경로)
- B: `shop.kt.com/unify/mobile.do?category=usim` (신 통합 경로)
- 동일 기능이지만 URL 다름 → Q/A 생성 시 **둘 다 포함하거나 신 경로(B)만 사용** 결정 필요

---

### 요고 다이렉트 / 요고다이렉트 상세

```
Shop > 요고 다이렉트 (공백 있음)           Shop > 요고다이렉트 (공백 없음)
 ├─ 요고 가입 > USIM 가입                   └─ 핸드폰등록및요금제변경
 ├─ 요고 가입 > USIM 구매
 ├─ 요고 가입 > eSIM 가입
 └─ 요고 가입 혜택
 (+ 상품 > 모바일 > 요금제 > 5G에도 포함)
```

→ 요고 서비스 관련 항목들이 Shop 내에서 두 노드로 분리됨

---

### 처리 방향 권고 (상세)

---

#### Case 1: `USIMeSIM 가입` vs `USIMeSIM가입`

**상황:** 크롤링 중 동일 카테고리("USIM/eSIM/자급제")가 두 노드로 분리됨. URL은 완전히 다르고 하위 항목도 다름.

```
USIMeSIM 가입 (4개)              USIMeSIM가입 (5개)
 ├─ 선불 USIM 구매충전             ├─ 선불USIM구매충전   ← 기능 동일, URL 다름
 └─ 휴대폰 요금제 가입             ├─ eSIM이동
      ├─ USIM 가입                  ├─ 데이터쉐어링가입
      ├─ USIM 구매                  ├─ 듀얼번호가입
      └─ eSIM 가입                  └─ 스마트기기요금제가입
```

**처리:** hierarchy 노드명을 `USIMeSIM가입`으로 통일 (공백 제거). 데이터(URL, text)는 그대로 유지.

```python
# 전처리 예시
item['hierarchy'] = [n.replace('USIMeSIM 가입', 'USIMeSIM가입') for n in item['hierarchy']]
```

---

#### Case 2: `요고 다이렉트` vs `요고다이렉트`

**상황:** Case 1과 동일 패턴. `요고 다이렉트`(5개)가 주요 경로, `요고다이렉트`(1개)는 별도 진입점.

```
요고 다이렉트 (5개)                  요고다이렉트 (1개)
 ├─ 요고 가입 > USIM 가입             └─ 핸드폰등록및요금제변경
 ├─ 요고 가입 > USIM 구매
 ├─ 요고 가입 > eSIM 가입
 └─ 요고 가입 혜택
 (상품 > 모바일 > 요금제 > 5G에도 포함)
```

**처리:** `요고 다이렉트`로 통일 (공백 유지, 다수 표기 기준).

```python
item['hierarchy'] = [n.replace('요고다이렉트', '요고 다이렉트') for n in item['hierarchy']]
```

---

#### Case 3: `선불 USIM 구매충전` vs `선불USIM구매충전`

**상황:** URL과 내용이 모두 다른 실질적으로 별개 페이지.

| | A (`USIMeSIM 가입` 하위) | B (`USIMeSIM가입` 하위) |
|---|---|---|
| URL | `/wireless/mobileList.do?category=usim` (구 경로) | `/unify/mobile.do?category=usim` (신 경로) |
| 내용 | 상품 목록 페이지 (11,678자) | 주문 옵션 선택 페이지 (7,681자) |
| docId | ktcom_3842 | ktcom_4 |

**처리:** 별도 처리 불필요. Case 1 정규화(`USIMeSIM 가입` → `USIMeSIM가입`)를 적용하면 A의 부모 노드명이 자동으로 통일됨.

```
Case 1 정규화 후:
A: ['Shop', 'USIMeSIM가입', '선불 USIM 구매충전']  ← 부모만 바뀜, 내용은 다른 페이지
B: ['Shop', 'USIMeSIM가입', '선불USIM구매충전']
```

하위 노드명(`선불 USIM 구매충전` vs `선불USIM구매충전`)은 **그대로 유지** — 내용이 다른 별개 페이지이므로 이름을 통일하면 오히려 혼란.

---

#### Case 4: `갤럭시 브랜드관` vs `갤럭시브랜드관`

**상황:** 동일 URL(`shop.kt.com/.../plnDispNo=2468`), 텍스트 길이도 7,580자로 동일.  
text가 "다르다"고 나온 이유: **조회수 숫자 3자리 차이** (`2,108,122` vs `2,108,088`) — 크롤링 시점 차이로 인한 동적 수치 변화.

```
A: Shop > 모바일 가입 > 갤럭시 브랜드관   (docId: ktcom_3850)
B: 상품 > 모바일 > 갤럭시브랜드관         (docId: ktcom_436)
```

**처리:** 둘 다 유지.  
이유: hierarchy 경로가 다름 (Shop 진입점 vs 상품 진입점) → 동일 페이지라도 **두 개의 서로 다른 카테고리 경로**에 대한 Q/A가 각각 생성되는 게 맞음. hierarchy 노드명만 `갤럭시브랜드관`으로 통일(공백 제거).

```python
item['hierarchy'] = [n.replace('갤럭시 브랜드관', '갤럭시브랜드관') for n in item['hierarchy']]
```

---

#### 요약

| Case | 변경 전 | 변경 후 | 변경 항목 수 |
|---|---|---|---|
| Case 1 | `USIMeSIM 가입` | `USIMeSIM가입` | 4개 |
| Case 2 | `요고다이렉트` | `요고 다이렉트` | 1개 |
| Case 4 | `갤럭시 브랜드관` | `갤럭시브랜드관` | 1개 |
| Case 3 (연동) | `선불USIM` 부모 노드 자동 통일 | — | — |

→ **전처리 후 총 항목: 1,106개 유지** (데이터 제거 없음, hierarchy 노드명 정규화만)

#### 실행 결과 (2026-03-06)

```
변경된 항목 수: 6개 / 총 항목 수: 1,106개
"USIMeSIM 가입"  잔존: 0개  →  "USIMeSIM가입"   적용: 9개
"요고다이렉트"   잔존: 0개  →  "요고 다이렉트"  적용: 6개
"갤럭시 브랜드관" 잔존: 0개  →  "갤럭시브랜드관" 적용: 2개
```

---

## 6. 기존 분석 보고서(plan.md) 검증 결과

### ✅ 맞는 내용

- 총 항목 1,106개 ✓
- 대분류 5개 및 비율 ✓
- 계층 깊이 분포 ✓
- JSON을 primary source로 사용 권장 ✓
- 파이프라인 흐름 방향 ✓

---

## 7. 결론 및 활용 가이드

### 사용할 파일

```
ref/data/data_2026-03-06_normalized.json  ← 정규화 적용본 (권장)
ref/data/data_2025-10-31_092604.json      ← 원본 (보존용)
```

### 로드 방법

```python
import json

with open('ref/data/data_2026-03-06_normalized.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# text 필드 사용 시 이스케이프 해제
for item in data:
    text = item['text'].replace('\\n', '\n')
```

> 원본(`data_2025-10-31_092604.json`)은 `utf-8-sig`, 정규화본은 `utf-8` 인코딩

### scraped/preprocessed/formatted 폴더 용도

- 중간 파이프라인 산출물 → **별도 사용 불필요**
- 특정 노드 원본 HTML 확인 필요 시: `scraped_results/` 참조
- 정제 과정 디버깅 필요 시: `preprocessed_results/` 참조

### 정규화 스크립트

- 위치: `normalize_data.py`
- 실행: `uv run python3 normalize_data.py`

---

## 8. 샘플 대시보드(index.html) 카테고리 등록 현황

### 참조 파일

```
ref/data/category_status.json
```

`data_2026-03-06_normalized.json` 기준 전체 카테고리 경로와 `index.html`의 `RAW_CATEGORIES` 등록 여부를 **등록 / 미등록** 두 그룹으로 분류해 저장한 파일.

### 파일 구조

```json
{
  "generated": "2026-03-06",
  "source": "ref/data/data_2026-03-06_normalized.json",
  "summary": {
    "total": 1106,
    "registered": 62,
    "missing": 1056,
    "coverage_pct": 5.6
  },
  "by_top_category": {
    "Shop":     { "total": 168, "registered": 27, "missing": 146, "coverage_pct": 16.1 },
    "상품":     { "total": 536, "registered":  4, "missing": 534, "coverage_pct":  0.7 },
    "고객지원": { "total": 302, "registered": 25, "missing": 281, "coverage_pct":  8.3 },
    "혜택":     { "total":  99, "registered":  5, "missing":  95, "coverage_pct":  5.1 },
    "마이":     { "total":   1, "registered":  1, "missing":   0, "coverage_pct": 100.0 }
  },
  "registered": { "Shop": [...], "상품": [...], ... },
  "missing":    { "Shop": [...], "상품": [...], ... }
}
```

### 현황 요약

| 항목 | 값 |
|---|---|
| 전체 카테고리 경로 | 1,106개 |
| index.html 등록 | 62개 |
| 미등록 | 1,056개 |
| 커버리지 | 5.6% |

> `index.html`은 현재 **샘플/데모 수준**으로 일부 카테고리만 하드코딩됨.  
> 전체 카테고리를 대시보드에 반영하려면 `RAW_CATEGORIES` 확장 또는 JSON 동적 로딩 방식 전환이 필요.

---

**작성:** 2026-03-06 (직접 코드 검증 기반)
