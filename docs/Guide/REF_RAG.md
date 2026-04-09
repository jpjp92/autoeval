<!--
파일: REF_RAG.md
설명: 문서 인제스션(PDF/DOCX 추출 → LLM/Rule 청킹 → Gemini 임베딩 → Supabase 저장) → 계층 태깅(H1/H2/H3) → QA 생성(벡터 검색)까지의 RAG 파이프라인 정리. 배치 티어 정책, 필터 조건, 메타데이터 스키마 포함. 평가 파이프라인은 REF_EVAL.md 참조.
업데이트: 2026-04-09
-->

# AutoEval RAG Pipeline

> 문서 업로드부터 벡터 검색 기반 QA 생성까지의 흐름 정리
> 평가 파이프라인(Layer 1~3, 점수 계산) → [REF_EVAL.md](REF_EVAL.md)

---

## 전체 흐름 요약

```
[문서 업로드]
  PDF / DOCX
      │
      ▼
[텍스트 추출]  parsers.extract_text_by_page()
  PDF  → PyMuPDF rawdict 모드  chars 단위 추출 + 한글 공백 복원
         detect_heading() : font>=10 패턴 매칭 / font_boost 이중 감지
         _KOR_CONT 병합   : y_gap > 15 AND font_diff > 1.5 시 병합 금지
  DOCX → python-docx XML  단락·표·Heading 스타일 구조 보존
      │
      ▼
[전처리 / 노이즈 필터]
  - normalize_text()          unicode 정규화, 이상 문자 제거
  - detect_repeated_headers() 반복 헤더 탐지
  - is_toc_chunk()            목차 블록 제거
  - _is_docx_noise_block()    커버·장식 요소 제거 (DOCX 전용)
      │
      ▼
[청킹]  두 경로 중 선택 (chunking_method 파라미터, 기본: llm)
  ┌──────────────────────┐     ┌──────────────────────────────────┐
  │  rule 청킹           │     │  LLM 청킹 (기본, 품질 우선)       │
  │  chunk_blocks_aware()│     │  run_llm_chunking()        (PDF) │
  │  RecursiveCharacter- │     │  run_llm_chunking_docx()  (DOCX) │
  │  TextSplitter        │     │  Gemini 2.5 Flash                │
  │  (LangChain)         │     │  페이지/블록 수 기반 티어 조정    │
  └──────────────────────┘     └──────────────────────────────────┘
      │
      ▼
[청크 후처리]
  - 중복 제거  (SHA-1 content_hash)
  - 최소 길이  (< 60자 → 제거)
  - context_prefix 부착  "[파일명] [섹션제목] (p.N)\n..."  ← rule 청킹만 적용
    LLM 청킹은 context_prefix 미부착 (text == raw_text)
      │
      ▼
[임베딩]  gemini-embedding-2-preview
  - task_type: RETRIEVAL_DOCUMENT
  - output_dimensionality: 1536
  - L2 정규화 후 저장
  - 배치: 64청크 단위
      │
      ▼
[벡터 DB 저장]  Supabase pgvector (doc_chunks)
  - content + metadata jsonb + embedding vector(1536)
  - document_id 전용 컬럼 (FK → doc_metadata)
  - 인덱스: HNSW (cosine), GIN (metadata jsonb)
      │
      ▼
[계층 분류]  H1 / H2 / H3 태깅
  - analyze-hierarchy      → 전체 청크 풀 랜덤 40개 → __admin__ 필터 → 최대 30개
                             LLM 1회 → H1/H2/H3 master + domain_profile 동시 생성
                             → doc_metadata upsert
  - analyze-tagging-samples → 기존 태깅 샘플 미리보기 (5개)
  - apply-granular-tagging → 청크별 h1/h2/h3 일괄 태깅
                             master 목록에서 선택만 허용, 신규 생성 금지
      │
      ▼
[QA 생성]  generation_api.py → generators/worker.py
  - sample_doc_chunks RPC 균등 샘플링 → h1/h2/h3 후처리 필터
  - doc_metadata에서 domain_profile 로드 (LLM 0회)
  - build_system_prompt() / build_user_template() 적응형 프롬프트 빌드
  - ThreadPoolExecutor 병렬 생성
    Claude Sonnet 4.6 (workers=2) / Gemini 3 Flash (workers=5) / GPT-5.2 (workers=5)
  - _dedup_across_chunks(sim_threshold=0.75) 중복 제거
  - total_qa == 0 → FAILED (DB 저장 건너뜀)
      │
      ▼
[결과 저장]
  Supabase qa_gen_results
  → 평가 파이프라인은 REF_EVAL.md 참조
```

---

## Stage 1 — 텍스트 추출

### PDF (`PyMuPDF / fitz`)

- `fitz.open()` → 페이지별 블록 순회 (rawdict 모드 — chars 단위 추출)
- 각 블록: `{"text", "font_size", "bbox", "page"}`
- 반복 헤더·푸터 탐지 후 후속 단계에서 제거

**파서 보정 규칙 (2026-04-09 적용)**

| 규칙                             | 대상                       | 내용                                                                                                                  |
| -------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| FIX-A — heading font 하한       | `detect_heading()`       | 패턴 매칭(`^제\s*\d+\s*장` 등) 시 `font_size >= 10.0` 조건 추가 — running header(font 8~9) 오분류 방지           |
| FIX-B —`_KOR_CONT` y_gap 가드 | `extract_text_by_page()` | 한글 어절 절단 병합 시 `y_gap > 15 AND font_diff > 1.5` 이면 별개 단락으로 간주 — heading+본문 첫 문장 오병합 방지 |

### DOCX (`python-docx` 직접 XML 파싱)

`parsers.py:727` — `doc.element.body` 자식 노드 순회

| 노드 타입      | 처리 방식                                                           |
| -------------- | ------------------------------------------------------------------- |
| `w:p` (단락) | `_iter_t()` 로 `w:t` 수집, `mc:Fallback` 하위 스킵(중복 방지) |
| `w:tbl` (표) | `_extract_table()` → `\| cell \| cell \|` 마크다운 행 구조 보존   |
| Heading 스타일 | `w:pStyle val` 값으로 font_size 18/16/14 매핑                     |

**LangChain `Docx2txtLoader`와의 차이점**

| 항목          | LangChain Docx2txtLoader | AutoEval                              |
| ------------- | ------------------------ | ------------------------------------- |
| 라이브러리    | `docx2txt`             | `python-docx` (XML 직접)            |
| 표 구조       | 텍스트 병합 (구조 손실)  | `\| cell \|` 행 구조 보존             |
| 제목 계층     | 없음                     | Heading 스타일 → font_size 추출      |
| Fallback 중복 | 없음                     | `mc:AlternateContent` Fallback 스킵 |
| 노이즈 필터   | 없음                     | `_is_docx_noise_block()`            |

---

## Stage 2 — 청킹

### 2-1. Rule 청킹 (`chunk_blocks_aware` + `RecursiveCharacterTextSplitter`)

```
섹션 경계 감지 → 섹션별 블록 수집
→ RecursiveCharacterTextSplitter(["\n\n", "\n", " ", ""])
→ _merge_short_chunks(min=300, max=1200)
```

`RecursiveCharacterTextSplitter`는 LangChain에서 가져온 유일한 컴포넌트.

### 2-2. LLM 청킹 (기본 경로)

| 항목          | PDF                                       | DOCX                                           |
| ------------- | ----------------------------------------- | ---------------------------------------------- |
| 함수          | `run_llm_chunking()`                    | `run_llm_chunking_docx()`                    |
| LLM           | Gemini 2.5 Flash                          | Gemini 2.5 Flash                               |
| 프롬프트      | `SYSTEM_PROMPT` (noise_correction 포함) | `DOCX_SYSTEM_PROMPT` (noise_correction 제거) |
| 파라미터 기준 | 페이지 수 (`recommend_params`)          | 블록 수 (`recommend_params_docx`)            |

#### 배치 티어 정책 (PDF 기준 — `recommend_params`)

| 티어 | 페이지 수 | batch_size | parallel | overlap | max_output_tokens |
| ---- | --------- | ---------- | -------- | ------- | ----------------- |
| S    | ≤ 20     | 30         | 3        | 3       | 8192              |
| M    | 21–50    | 30         | 3        | 3       | 8192              |
| L    | 51–100   | 40         | 5        | 3       | 12288             |
| XL   | 101–200  | 50         | 5        | 5       | 16384             |
| XXL  | 200+      | 50         | 5        | 5       | 16384             |

#### 배치 티어 정책 (DOCX 기준 — `recommend_params_docx`)

| 티어 | 블록 수  | batch_size | parallel | overlap |
| ---- | -------- | ---------- | -------- | ------- |
| S    | ≤ 60    | 30         | 3        | 3       |
| M    | 61–150  | 30         | 3        | 3       |
| L    | 151–300 | 40         | 5        | 3       |
| XL   | 300+     | 50         | 5        | 5       |

#### 배치 분할 (`build_char_aware_batches`)

- 블록 수(`batch_size`)와 누적 문자 수(`max_chars=4000`) 중 먼저 도달한 기준 적용
- 표 블록(~1,600자) 포함 시 토큰 폭발 방지

#### DOCX 청킹 규칙 요약

- 제목 블록 → 독립 청크 금지, 바로 뒤 내용 첫 줄로 포함
- 청크 크기: 최소 200자, 최대 800자
- 표 블록: `[표] 제목\n내용` 형태로 자연어 변환 후 포함
- 배치 간 `overlap` 블록으로 맥락 연속성 유지

---

## Stage 3 — 청크 후처리 & 품질 필터

```python
# 공통 필터 체인
is_toc_chunk()          # 목차 감지 → 제거
_is_colophon_chunk()    # 판권/후기 → 제거
_is_symbol_noise_chunk()# 기호 노이즈 → 제거
remove_footer_noise()   # 반복 헤더·푸터 제거
len(chunk) < 60         # 최소 길이 미달 → 제거
SHA-1 content_hash      # 완전 중복 → 제거
```

통과한 청크에 context_prefix 부착:

```
[파일명] [섹션제목] (p.N)
────────────────────────
실제 청크 내용 ...
```

> **경로별 context_prefix 차이**:
>
> - **Rule 청킹** (`ingest_with_rule_chunking`): `build_context_prefix()` 호출 → `text = prefix + raw_text`, `raw_text` 별도 보존. 임베딩 입력에 prefix 포함.
> - **LLM 청킹** (`ingest_with_llm_chunking`): context_prefix **미부착** → `text == raw_text`. 임베딩은 원문 그대로 저장.

---

## Stage 4 — 임베딩 & 벡터 저장

### 임베딩 모델

| 항목      | 값                                                         |
| --------- | ---------------------------------------------------------- |
| 모델      | `gemini-embedding-2-preview`                             |
| 차원      | 1536 (HNSW 2000차원 제한 고려)                             |
| task_type | `RETRIEVAL_DOCUMENT` (저장) / `RETRIEVAL_QUERY` (검색) |
| 배치 크기 | 64 청크 단위                                               |
| 정규화    | L2 Normalization 후 저장                                   |

### Supabase `doc_chunks` 테이블

```sql
doc_chunks (
  id          uuid PRIMARY KEY,
  content     text NOT NULL,        -- 청크 원문
  metadata    jsonb,                -- 파일명·페이지·계층·chunk_type 등
  embedding   vector(1536),         -- 정규화된 임베딩 벡터
  document_id text REFERENCES doc_metadata(document_id) ON DELETE SET NULL,
  created_at  timestamptz
)
```

> `document_id`는 `metadata` jsonb가 아닌 **전용 컬럼**으로 저장 — 컬럼 인덱스 활용, metadata 중복 제거.

#### 인덱스

| 인덱스                         | 용도                     |
| ------------------------------ | ------------------------ |
| HNSW (cosine) on `embedding` | 벡터 유사도 검색         |
| GIN on `metadata`            | 계층·파일명 필터 고속화 |
| B-tree on `created_at`       | 최신순 정렬              |

#### 메타데이터 주요 필드

```json
{
  "filename":       "문서명.pdf",
  "page":           3,
  "chunk_index":    12,
  "total_chunks":   45,
  "chunk_type":     "paragraph | table | heading | ...",
  "section_title":  "1.2 시스템 구성",
  "char_length":    412,
  "content_hash":   "sha1hex",
  "hierarchy_h1":   "AI 기본법",
  "hierarchy_h2":   "제2장 의무",
  "hierarchy_h3":   "제7조 투명성",
  "chunking_method":"llm",
  "embedding_model":"gemini-embedding-2-preview",
  "ingested_at":    "2026-04-02T10:00:00",
  "source":         "pdf | docx"
}
```

> `section_path`, `section_level`은 현재 코드에서 생성하지 않음.

---

## HNSW & L2 정규화 상세

### HNSW (Hierarchical Navigable Small World)

HNSW는 고차원 벡터 공간에서 **근사 최근접 이웃(ANN, Approximate Nearest Neighbor)** 검색을 빠르게 수행하기 위한 그래프 기반 인덱싱 알고리즘이다. Supabase pgvector에서 `USING hnsw (embedding vector_cosine_ops)` 구문으로 생성된다.

#### 구조

```
Layer 3 (최상위) : 소수 노드 — 장거리 점프
Layer 2          : 중간 밀도
Layer 1          : 더 조밀
Layer 0 (최하위) : 전체 벡터 포함
```

- **상위 레이어** — 데이터의 부분 집합만 포함. 노드 간 연결 거리가 커서 넓은 범위를 빠르게 탐색 ("장거리 점프").
- **최하위 레이어(Layer 0)** — 모든 벡터 포함. 세밀한 이웃 탐색 담당.

#### 검색 흐름

1. 최상위 레이어 진입점에서 탐색 시작
2. 현재 노드 이웃 중 쿼리에 가장 가까운 노드로 이동 (Greedy Search)
3. 현재 레이어에서 더 이상 가까워질 수 없으면 한 단계 아래 레이어로 내려감
4. Layer 0에 도달하면 최종 후보 `match_count`개 반환

검색 복잡도는 **O(log N)**으로, 데이터셋 크기가 커져도 효율적이다.

#### AutoEval 설정

```sql
-- setup_vector_db.sql
CREATE INDEX IF NOT EXISTS idx_doc_chunks_hnsw
ON doc_chunks USING hnsw (embedding vector_cosine_ops);
```

| 항목 | 값 |
| ---- | -- |
| 인덱스 방식 | `hnsw` |
| 거리 연산자 | `vector_cosine_ops` (`<=>` 코사인 거리) |
| 벡터 차원 | 1536 (HNSW pgvector 2000차원 제한 고려) |
| pgvector 버전 | Supabase 기본 제공 |

유사도 쿼리:

```sql
1 - (embedding <=> query_embedding) AS similarity  -- 코사인 유사도 (0~1)
ORDER BY embedding <=> query_embedding             -- 거리 오름차순 = 유사도 내림차순
```

`<=>` 연산자는 코사인 **거리** (1 − 유사도)를 반환하므로, `1 − 거리`로 유사도를 계산한다.

---

### L2 정규화 (L2 Normalization)

벡터를 저장하거나 검색할 때 그 **크기(norm)를 1로 스케일링**하는 전처리 단계다. 머신러닝의 가중치 감소(Weight Decay)와는 다른 개념이다.

#### 수식

$$\hat{v} = \frac{v}{\|v\|_2}, \quad \|v\|_2 = \sqrt{\sum_i v_i^2}$$

#### AutoEval 적용 위치

**문서 청크 저장 시** (`ingestion/pipeline.py`):

```python
embedding_np = np.array(emb_data.values)
norm = np.linalg.norm(embedding_np)   # L2 Norm 계산
normalized_embedding = (embedding_np / norm).tolist() if norm > 0 else emb_data.values
```

**쿼리 벡터 생성 시** (`generators/worker.py`):

```python
v_np = np.array(res.embeddings[0].values)
v_norm = np.linalg.norm(v_np)
query_vector = (v_np / v_norm).tolist() if v_norm > 0 else res.embeddings[0].values
```

#### 정규화가 필요한 이유

코사인 유사도는 정의상 두 벡터의 크기 정보를 제거하고 방향(각도)만 비교한다.

$$\cos(\theta) = \frac{v \cdot u}{\|v\|\|u\|}$$

L2 정규화로 저장된 벡터 `v̂`는 이미 `‖v̂‖ = 1`이므로, pgvector의 코사인 거리 연산자 `<=>` 내부에서 분모 나눗셈이 단순화된다. 즉:

- **검색 결과 동등**: 정규화 여부와 무관하게 코사인 유사도 순위는 동일하다.
- **수치 안정성**: 저장/쿼리 단계 모두 정규화를 적용하면 분모 값이 항상 1에 가까워 수치 오차가 줄어든다.
- **일관성**: 임베딩 모델 출력 벡터의 크기가 다소 달라도 정규화를 통해 비교 기준을 통일한다.

#### 정규화 적용 흐름 요약

```
[Gemini Embedding 2 API 응답] → raw float[] (1536차원)
         │
         ▼ np.linalg.norm()
[L2 Norm 계산] → scalar
         │
         ▼ embedding / norm
[정규화된 벡터] → Supabase vector(1536) 저장
                  (RETRIEVAL_DOCUMENT 저장 / RETRIEVAL_QUERY 검색 모두 동일)
```

| task_type | 사용 위치 | 정규화 |
| --------- | --------- | ------ |
| `RETRIEVAL_DOCUMENT` | 청크 저장 (`pipeline.py`) | ✅ |
| `RETRIEVAL_QUERY` | 검색 쿼리 (`worker.py`) | ✅ |

---

## Stage 5 — 계층 분류 (H1/H2/H3 태깅)

### 엔드포인트 순서

```
POST /api/ingestion/analyze-hierarchy
  └─ sample_doc_chunks RPC → 전체 청크 풀에서 랜덤 40개 추출
  └─ __admin__ 청크 필터 제거 → 최대 30개 (filtered[:30])
  └─ 청크당 최대 글자 수 동적 조정: max(400, 20000 // len(anchor_chunks))
  └─ LLM 1회 호출 (gemini-3-flash-preview)
  └─ H1(3~5개) + H2/H3 전체 master + domain_profile 동시 생성
  └─ doc_metadata upsert (h2_h3_master + domain_profile)

POST /api/ingestion/analyze-tagging-samples
  └─ 이미 태깅된 청크 샘플 5개 반환 (미리보기용)

POST /api/ingestion/apply-granular-tagging
  └─ 전체 청크 metadata.hierarchy_h1/h2/h3 일괄 업데이트
  └─ master_hierarchy 목록에서 선택만 허용 (신규 생성 금지)
  └─ patch_chunk_hierarchy RPC (jsonb merge)
```

> `analyze-hierarchy`가 H1/H2/H3 master와 domain_profile을 **단일 LLM 호출**로 동시 생성한다.

### anchor 샘플링 상세

실제 Supabase 함수는 `chunk_index` 기준 **등간격 stride** 방식 (상세: [REF_DB.md](REF_DB.md#sample_doc_chunks)).

```
step_size = GREATEST(total_count / p_n, 1)
WHERE (rn - 1) % step_size = 0   ← 전역 chunk_index 순 균등 추출
```

| 단계 | 처리 |
| ---- | ---- |
| 1    | Supabase RPC로 document_id 기준 최신 버전에서 균등 40개 추출 |
| 2    | `__admin__` 청크 제거 (목차·커버 등 노이즈) |
| 3    | 필터 후 10개 미만이면 필터 취소 → 원본 40개 복원 |
| 4    | `filtered[:30]` — 최종 anchor 청크 확정 |
| 5    | 청크당 글자 수 상한: `max(400, 20000 // 청크수)` (30개 기준 최대 666자/청크) |

**LLM 입력 총량**: anchor 수 × 청크당 상한 ≈ **최대 약 20,000자** 고정

### 재인제스션 시 구버전 처리

`get_hierarchy_list()` 조회 시 동일 filename의 **최신 `document_id`만 사용**. 재인제스션 후 구버전 청크의 H1이 드롭다운에 누적되는 현상 방지.

```python
# hierarchy_repo.py 내 로직
# filename → (document_id, ingested_at) 매핑에서 ingested_at 최신 것만 유지
latest_doc_ids: dict[str, tuple[str, str]] = {}
for chunk in chunks:
    if fn and did:
        prev = latest_doc_ids.get(fn)
        if prev is None or iat > prev[1]:
            latest_doc_ids[fn] = (did, iat)
```

### 드롭다운 노출 필터 (`hierarchy_repo.py`)

계층 선택 UI에서 QA 생성 불가 노드 사전 제거:

```python
MIN_CHUNKS_FOR_QA = 1     # 법률 문서 조문 단위(1개/조문) 허용을 위해 1로 설정
MIN_CONTENT_CHARS = 300   # 총 텍스트 < 300자 → 제외
```

**필터 조건 (h2/h3 계층별 상이)**:

- h3: 청크 수 < MIN_CHUNKS_FOR_QA **AND** 총 chars < MIN_CONTENT_CHARS → 둘 다 미달일 때만 제외
- h2 (독립 존재 시): 청크 수 >= MIN_CHUNKS_FOR_QA **OR** chars >= MIN_CONTENT_CHARS → 하나만 충족해도 노출
- h1: 유효한 h2가 하나도 없으면 제외

→ 단순히 청크 1개라도 있거나 텍스트가 충분하면 노출. 통계 문서처럼 표 데이터 위주(짧지만 의미 있는) 청크도 포함.

---

## Stage 6 — QA 생성 (Vector DB 검색)

### 청크 수집 전략

| 조건                     | 수집 방식                                                        |
| ------------------------ | ---------------------------------------------------------------- |
| `retrieval_query` 있음 | Semantic Search (`match_doc_chunks` RPC, cosine 유사도 ≥ 0.3) |
| `document_id` 있음     | `get_doc_chunks_sampled()` → 후처리 hierarchy 필터            |
| hierarchy 필터만 있음    | `get_doc_chunks_by_filter()` metadata 조회                     |

### Semantic Search (`match_doc_chunks` RPC)

```sql
SELECT id, content, metadata,
       1 - (embedding <=> query_embedding) AS similarity
FROM doc_chunks
WHERE metadata @> filter          -- hierarchy 메타데이터 필터
  AND 1 - (embedding <=> query_embedding) > match_threshold
ORDER BY embedding <=> query_embedding
LIMIT match_count;
```

쿼리 임베딩 생성: `task_type=RETRIEVAL_QUERY` + L2 정규화

### QA 생성 후 가드

```python
if total_qa == 0:
    job_manager.update_job(job_id, status=JobStatus.FAILED,
        message="선택한 계층의 컨텍스트가 부족하여 QA를 생성할 수 없습니다.")
    return  # DB 저장 건너뜀
```

---

## 일반 RAG vs AutoEval 비교

### 유사점

| 일반 RAG | AutoEval |
| -------- | -------- |
| Knowledgebase → Vector DB (청킹 + 임베딩) | PDF/DOCX → Supabase pgvector (청킹 + Gemini Embedding 2) |
| Query → Retriever → Vector DB 검색 | `retrieval_query` → `match_doc_chunks` RPC (코사인 유사도) |
| Chunks of text → Augmentation | 검색된 청크 → QA 생성 프롬프트에 컨텍스트로 주입 |
| Generation by LLM | Claude / Gemini / GPT 중 선택하여 QA 생성 |
| Response 반환 | `qa_gen_results` 저장 |

### 차이점

#### 1. Retriever 목적이 다름
일반 RAG는 **사용자 질의에 답변**하기 위해 청크를 검색한다. AutoEval은 **QA 쌍 생성을 위한 시드 컨텍스트 수집**이 목적이다. 검색된 청크가 "답"이 아니라 "QA를 만들 재료"로 사용된다.

#### 2. 청킹에 LLM 사용
일반 RAG는 보통 `RecursiveCharacterTextSplitter` 같은 rule 기반 청킹을 사용하지만, AutoEval은 **Gemini 2.5 Flash가 직접 의미 단위로 청킹**한다. 표·제목·법조문 구조 인식이 포함된다.

#### 3. 벡터 저장 후 수동 계층 태깅 단계 존재
일반 RAG에 없는 단계. 벡터 저장 후 **H1/H2/H3 계층 분류를 별도 LLM 호출**로 수행하고 metadata에 패치한다. 이를 기반으로 검색 필터를 사전에 좁힌다.

#### 4. Retrieval이 선택적 (3가지 수집 전략)
일반 RAG는 항상 벡터 검색을 통하지만, AutoEval은 상황에 따라 분기한다:

```
retrieval_query 있음 → 벡터 유사도 검색 (match_doc_chunks RPC)
document_id만 있음  → 균등 stride 샘플링 (get_doc_chunks_sampled)
hierarchy 필터만    → metadata 조건 조회 (get_doc_chunks_by_filter)
```

#### 5. Augmentation 단계에서 도메인 프로파일 주입
일반 RAG의 Augmentation은 단순 "쿼리 + 청크" 병합이지만, AutoEval은 **`doc_metadata`에서 `domain_profile`을 로드해 프롬프트에 추가**한다 (문서의 목적·대상 독자·도메인 특성 등). 계층 분류 단계에서 사전 생성된 프로파일을 재사용하므로 LLM 추가 호출 없음.

#### 6. 생성 후 QA 품질 가드
일반 RAG는 Response를 바로 반환하지만, AutoEval은 생성 후 추가 처리를 거친다:

- `_dedup_across_chunks(sim_threshold=0.75)` — 의미 중복 QA 제거
- `total_qa == 0` → FAILED 처리 (DB 저장 건너뜀)
- 이후 별도 평가 파이프라인(Layer 1~3) 존재 → [REF_EVAL.md](REF_EVAL.md)

### 전체 구조 대응도

```
일반 RAG                        AutoEval
──────────────────────────────────────────────────────────────
Knowledgebase                → PDF / DOCX
Vector DB 구축                → LLM 청킹 + Gemini Embedding 2
                                + H1/H2/H3 계층 태깅 (추가 단계)
Query                        → retrieval_query (선택적)
Retriever                    → match_doc_chunks RPC
                                or 균등 샘플링 / metadata 필터
Augmentation                 → domain_profile + 청크 컨텍스트
                                → QA 생성 프롬프트
Generation by LLM            → Claude / Gemini / GPT (병렬, 선택)
Response                     → qa_gen_results → 평가 파이프라인
```

> **핵심 차이**: 일반 RAG는 "검색해서 답변", AutoEval은 "검색해서 QA를 만들고, 그 QA를 다시 평가"하는 2단 구조.

---

## 사용 라이브러리 요약

| 라이브러리                   | 역할                               | 비고                          |
| ---------------------------- | ---------------------------------- | ----------------------------- |
| `PyMuPDF (fitz)`           | PDF 텍스트·블록 추출              |                               |
| `python-docx`              | DOCX XML 파싱 (단락/표/제목)       | `docx2txt` 미사용           |
| `google-genai`             | Gemini 임베딩·청킹 LLM            | Gemini 2.5 Flash, Embedding 2 |
| `langchain-text-splitters` | `RecursiveCharacterTextSplitter` | rule 청킹 경로에서만 사용     |
| `supabase-py`              | pgvector DB 연동                   |                               |
| `anthropic`                | Claude Sonnet 4.6 QA 생성          |                               |
| `openai`                   | GPT-5.2 QA 생성                    |                               |
| `numpy`                    | 임베딩 L2 정규화                   |                               |

---

## 주요 파일 위치

```
backend/
├── api/
│   ├── ingestion_api.py       # 업로드·계층 분석 엔드포인트
│   └── generation_api.py      # QA 생성·벡터 검색
├── ingestion/
│   ├── pipeline.py            # 청킹 → 임베딩 → Supabase 저장 오케스트레이터
│   ├── chunker.py             # LLM/Rule 청킹 경로 분기, 공통 필터 적용
│   ├── parsers.py             # PDF/DOCX 추출, 전처리, rule 청킹 유틸
│   ├── llm_chunker.py         # Gemini 기반 LLM 청킹 (PDF/DOCX 분기)
│   ├── tagging.py             # 청크 hierarchy 태깅 핵심 로직 (run_tagging)
│   └── prompts.py             # 계층 분석·태깅용 LLM 프롬프트
├── db/
│   └── hierarchy_repo.py      # H1/H2/H3 드롭다운 필터 (MIN_CHUNKS/CHARS)
└── scripts/
    └── setup_vector_db.sql    # pgvector 테이블·인덱스·RPC 정의
```
