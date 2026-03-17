# 🔥 수정 우선순위 정리 (2026-03-17)

> 근거: DEV_260317.md 분석 + 전체 코드 플로우 리뷰
> 원칙: "현재 QA 생성 파이프라인이 실제로 동작하는가?" 기준으로 우선순위 결정

---

## 전체 흐름 (현재 As-Is)

```
POST /api/generate
    │
    ├─ [generation_api.py] 청크 조회
    │       hierarchy 필터 있으면 → search_doc_chunks(dummy_zero_vector)  ← 불확정
    │       결과 없으면 → JSON fallback (KT 통신사 데이터)               ← 항상 여기
    │
    └─ [main.py:generate_qa()] LLM 호출
            system_prompt = SYSTEM_PROMPT_KO_V1  ("통신사 전문가")        ← 도메인 불일치
            text = item["text"][:2000]            (prefix 포함 raw content) ← 구조 텍스트 오인
            → LLM이 잘못된 도메인 + 잘못된 본문으로 QA 생성
```

**결론: 현재 QA 생성 파이프라인은 DB 청크를 실질적으로 사용하지 못하고,
사용하더라도 LLM에 잘못된 텍스트가 전달되는 상태.**

---

## P0 — QA 생성 파이프라인 최소 동작 조건

> 이 3개가 해결되어야 DB 기반 QA 생성이 처음으로 제대로 동작함.
> 상호 독립적이므로 병렬 수정 가능.

### P0-1. `main.py:278` — context prefix 제거 ✅ 이미 해결됨

```python
# ingestion_api.py:820 확인 결과
await save_doc_chunk(c["raw_text"], normalized_embedding, chunk_metadata)
# → DB content 필드 = raw_text (순수 본문, prefix 없음)
# → enriched_text(prefix 포함)는 임베딩 품질을 위해 embedding에만 사용됨

# main.py:278 현재 코드
text = item.get("text", "")[:2000]
# item["text"] = c.get("content") = raw_text → prefix 없음, 정상
```

**결론**: DEV_260317.md의 P0-1 분석은 구버전 기준. 현재 코드는 이미 raw_text 저장.
`[:2000]` 제한도 청크 크기(200~1200자)를 감안하면 실질적 문제 없음. **수정 불필요.**

---

### P0-2. `generation_api.py:302` — dummy zero vector 제거

```python
# 현재 (문제)
if query_vector is None:
    query_vector = [0.0] * 1536  # → cosine similarity 불확정, 결과 신뢰 불가

# 수정: match_doc_chunks RPC 대신 직접 테이블 select + metadata 필터
chunks = supabase.table("doc_chunks") \
    .select("id, content, metadata") \
    .eq("metadata->>hierarchy_l1", h1) \
    .limit(samples) \
    .execute().data
```

**영향**: hierarchy 필터가 있는 경우의 청크 선택 신뢰성

---

### P0-3. `config/prompts.py` — 시스템 프롬프트 도메인 하드코딩 제거

```python
# 현재 (문제)
SYSTEM_PROMPT_KO_V1 = "당신은 통신사 고객지원 QA 데이터셋 생성 전문가입니다."

# 수정 방향 (DEV_PROMPT_ADAPTIVE.md 참조)
# 단기: 범용 표현으로 교체 ("당신은 문서 기반 QA 데이터셋 생성 전문가입니다")
# 중기: build_system_prompt(domain_profile) 동적 구성
```

**영향**: 모든 QA 생성 결과의 도메인 적합성

---

## P1 — DB 워크플로우 완성 (JSON fallback 제거 선행 조건)

> P0 완료 후 진행. DB에서 청크를 정상 조회해야 의미 있음.

### P1-1. `generation_api.py` — heading / 발행처 청크 skip

```python
# 현재: 모든 청크에 QA 생성 시도
# 수정: skip 조건 추가
COLOPHON_KEYWORDS = ["발행처:", "발행인:", "저작권", "©", "무단전재"]

def should_skip_chunk(chunk: dict) -> bool:
    meta = chunk.get("metadata", {})
    content = chunk.get("content", "")
    if meta.get("chunk_type") == "heading":
        return True
    if sum(1 for kw in COLOPHON_KEYWORDS if kw in content) >= 2:
        return True
    return False
```

**영향**: 무의미한 청크(57자 heading, 발행처 페이지)에 대한 LLM 호출 낭비 제거

---

### P1-2. `backend/ingestion_api.py` — `GET /api/ingestion/hierarchy-list` 엔드포인트 추가

```python
# supabase_client.py에 get_hierarchy_list() 함수 이미 존재
# → 라우터 연결만 필요

@router.get("/hierarchy-list")
async def get_hierarchy_list_api():
    result = get_hierarchy_list()  # {"l1_list": [...], "l2_map": {...}}
    return result
```

**영향**: 프론트엔드가 DB L1/L2 목록을 동적으로 조회 가능

---

### P1-3. `QAGenerationPanel.tsx` — hierarchy 하드코딩 제거 + DB 드롭다운

```tsx
// 현재 (문제)
const hierarchy = ["Shop", "USIM/eSIM 가입", "선불 USIM 구매/충전"];  // 통신사 하드코딩

// 수정
// - 컴포넌트 마운트 시 GET /api/ingestion/hierarchy-list 호출
// - L1 드롭다운 선택 → L2 드롭다운 필터링
// - generateQA() 호출 시 hierarchy_l1/l2/l3 파라미터 전달
```

**영향**: 프론트에서 실제 DB 계층 기반으로 QA 생성 요청 가능

---

### P1-4. `config/constants.py` — JSON fallback 명시적 경고 처리

```python
# 현재: 조용히 fallback
# 수정: fallback 진입 시 WARNING 로그 + 향후 제거 예정 명시
logger.warning(
    "⚠️ [DEPRECATED] JSON fallback 사용 중 — DB 청크가 비어있거나 필터 미지정. "
    "ref/data/data_2026-03-06_normalized.json (KT 통신사 데이터)가 사용됩니다."
)
```

**영향**: fallback 동작을 명시적으로 인지 가능, 추후 완전 제거 전환점

---

## P2 — Ingestion 품질 개선 (재인제스션 필요)

> P1 완료 후 진행. 재인제스션 후 DB content 재검토 필요.
> DEV_260317.md에 구현 코드 초안 포함.

### P2-1. `ingestion_api.py` — `normalize_text` 강화

| 항목 | 코드 위치 | 내용 |
|------|-----------|------|
| `Ÿ` → `-` 정규화 | `normalize_text()` | PDF 불릿 폰트 아티팩트 |
| `smart_join_lines` | `normalize_text()` | 문장 중간 줄바꿈 → 공백 |

### P2-2. `ingestion_api.py` — `merge_short_chunks` 후처리

- 스플리터 이후 단계에 삽입
- 같은 `section_path` 내 200자 미만 청크 → 다음 청크와 병합 (최대 1200자)

### P2-3. `ingestion_api.py` — `is_colophon_chunk` 필터

- 발행처/저작권 키워드 2개 이상 → 청크 제외
- 재인제스션 시 [11]번 청크(발행처 페이지) 자동 제외

**영향**: 재인제스션 후 청크 품질 전반 개선 → QA 생성 품질 상승

---

## P3 — 적응형 프롬프트 (DEV_PROMPT_ADAPTIVE.md)

> P0~P1 완료 후 진행. 이 단계부터는 "더 좋게" 개선 작업.

### P3-1. `backend/domain_profiler.py` 신규

- `analyze_domain(chunks_sample, model)` → `domain_profile` JSON
- L1별 분산 샘플 10개, LLM 1회 호출, job 내 캐시

### P3-2. `config/prompts.py` 빌더 함수화

- `build_system_prompt(domain_profile, lang)`
- `build_user_template(domain_profile, chunk_type, n_qa)`
- `generate_intent_examples(domain_profile)` — key_terms 기반 동적 예시
- 기존 상수 `SYSTEM_PROMPT_KO_V1` → deprecated fallback으로 유지

### P3-3. `generation_api.py` — 2단계 흐름 통합

- job 시작 시 `analyze_domain()` 1회 호출
- 청크별 생성 시 캐시된 `domain_profile` 사용

---

## P4 — 선택적 개선

> 운영 안정화 후 여유 시점에.

| 항목 | 파일 | 내용 |
|------|------|------|
| chunk_type별 intent 가중치 | `prompts.py` / `domain_profiler.py` | table→numeric, list→procedure |
| DB domain_profile 캐시 | `supabase_client.py` | 동일 filename 재실행 시 1단계 skip |
| `chunk_type` / `page` 키 불일치 수정 | `generation_api.py` | `m.get("pages")` → `m.get("page")`, `m.get("type")` → `m.get("chunk_type")` |

---

## 의존성 그래프

```
P0-1 (prefix 제거)  ─┐
P0-2 (zero vector)  ─┼─→ DB 기반 QA 생성 최초 동작
P0-3 (프롬프트 범용) ─┘
                       │
                       ▼
P1-1 (heading skip)           ← P0와 병렬 가능
P1-2 (hierarchy-list API)  ─┐
P1-3 (프론트 드롭다운)      ─┘─→ DB 워크플로우 완성
P1-4 (fallback 경고)
                       │
                       ▼
P2 (ingestion 개선 → 재인제스션)
                       │
                       ▼
P3 (적응형 프롬프트 2단계)
                       │
                       ▼
P4 (선택적 개선)
```

---

## 이번 세션 구현 순서 (권장)

```
1. P0-3  config/prompts.py 범용 표현으로 단기 수정 (5분)
2. P0-1  main.py _strip_context_prefix 추가 (10분)
3. P0-2  generation_api.py 직접 select 필터 교체 (15분)
4. P1-1  generation_api.py heading/발행처 skip (10분)
5. P1-4  constants.py fallback 경고 (5분)
---- 여기까지: DB 기반 QA 생성 최초 정상 동작 ----
6. P1-2  ingestion_api.py hierarchy-list 엔드포인트 (10분)
7. P1-3  QAGenerationPanel.tsx 드롭다운 (20분)
---- 여기까지: 프론트-백 전체 DB 워크플로우 완성 ----
8. P2    ingestion 개선 → 재인제스션
9. P3    domain_profiler.py 신규 + prompts.py 빌더화
```
