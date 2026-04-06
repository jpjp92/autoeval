<!--
파일: REF_RAG.md
설명: 문서 인제스션(PDF/DOCX 추출 → LLM/Rule 청킹 → Gemini 임베딩 → Supabase 저장) → 계층 태깅(H1/H2/H3) → QA 생성(벡터 검색) → 평가 파이프라인 전체 흐름 정리. 배치 티어 정책, 필터 조건, 메타데이터 스키마 포함.
업데이트: 2026-04-06
-->
# AutoEval RAG Pipeline

> 문서 업로드부터 벡터 검색 기반 QA 생성·평가까지의 전체 흐름 정리

---

## 전체 흐름 요약

```
[문서 업로드]
  PDF / DOCX
      │
      ▼
[텍스트 추출]  parsers.extract_text_by_page()
  PDF  → PyMuPDF(fitz)     블록 단위 추출
  DOCX → python-docx XML   단락·표 블록 구조 추출
      │
      ▼
[전처리 / 노이즈 필터]
  - normalize_text()         unicode 정규화, 이상 문자 제거
  - detect_repeated_headers() 반복 헤더 탐지
  - is_toc_chunk()           목차 블록 제거
  - _is_docx_noise_block()   커버·장식 요소 제거 (DOCX 전용)
      │
      ▼
[청킹]  두 경로 중 선택 (기본: llm)
  ┌──────────────────┐     ┌────────────────────────────────┐
  │  rule 청킹       │     │  LLM 청킹 (기본, 품질 우선)     │
  │ chunk_blocks_    │     │  run_llm_chunking()      (PDF) │
  │ aware()          │     │  run_llm_chunking_docx() (DOCX)│
  │ RecursiveCharac- │     │  Gemini 2.5 Flash              │
  │ terTextSplitter  │     │  의미 단위 배치 병렬 처리       │
  └──────────────────┘     └────────────────────────────────┘
      │
      ▼
[청크 후처리]
  - 중복 제거  (SHA-1 content_hash)
  - 너무 짧은 청크 병합  (< 60자 → 제거, < 300자 → 인접 병합)
  - context_prefix 부착  "[파일명] [섹션제목] (p.N)\n..."
      │
      ▼
[임베딩]  Gemini Embedding 2 Preview
  - task_type: RETRIEVAL_DOCUMENT
  - output_dimensionality: 1536
  - L2 정규화 후 저장
      │
      ▼
[벡터 DB 저장]  Supabase pgvector
  - 테이블: doc_chunks
  - 인덱스: HNSW (cosine), GIN (metadata jsonb)
      │
      ▼
[계층 분류]  H1 / H2 / H3 태깅
  - analyze-hierarchy   → H1 후보 도출
  - analyze-h2-h3       → H2/H3 마스터 생성
  - apply-granular-tagging → 청크별 계층 메타데이터 업데이트
      │
      ▼
[QA 생성]  generation_api.py
  - 벡터 DB에서 계층 필터 또는 semantic search로 청크 수집
  - 다중 LLM(Claude Sonnet / Gemini Flash / GPT-5.2)으로 QA 생성
  - total_qa == 0 → FAILED (DB 저장 건너뜀)
      │
      ▼
[평가 파이프라인]  evaluators/pipeline.py
  Layer 1-A  구문 검증 (SyntaxValidator)
  Layer 1-B  통계 검증 (DatasetStats)
  Layer 2    RAG Triad (관련성·근거성·맥락성)  Claude Haiku
  Layer 3    품질 평가 (완전성)               Claude Haiku
      │
      ▼
[결과 저장 & 대시보드]
  Supabase qa_generation_results / qa_evaluation_scores
  Frontend: QAEvaluationDashboard
```

---

## Stage 1 — 텍스트 추출

### PDF (`PyMuPDF / fitz`)

- `fitz.open()` → 페이지별 블록 순회
- 각 블록: `{"text", "font_size", "bbox", "page"}`
- 반복 헤더·푸터 탐지 후 후속 단계에서 제거

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

| 티어 | 페이지 수  | batch_size | parallel | overlap | max_output_tokens |
| ---- | ---------- | ---------- | -------- | ------- | ----------------- |
| S    | ≤ 20      | 30         | 3        | 3       | 8192              |
| M    | 21–50     | 30         | 3        | 3       | 8192              |
| L    | 51–100    | 40         | 5        | 3       | 12288             |
| XL   | 101–200   | 50         | 5        | 5       | 16384             |
| XXL  | 200+       | 50         | 5        | 5       | 16384             |

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
  id         uuid PRIMARY KEY,
  content    text NOT NULL,        -- 청크 원문
  metadata   jsonb,                -- 파일명·페이지·계층·chunk_type 등
  embedding  vector(1536),         -- 정규화된 임베딩 벡터
  created_at timestamptz
)
```

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

> **주의**: `document_id`는 metadata jsonb가 아닌 `doc_chunks.document_id` 별도 컬럼으로 저장.
> `section_path`, `section_level`은 현재 코드에서 생성하지 않음.

---

## Stage 5 — 계층 분류 (H1/H2/H3 태깅)

### 엔드포인트 순서

```
POST /api/ingestion/analyze-hierarchy
  └─ H1 후보 도출 (LLM)

POST /api/ingestion/analyze-h2-h3
  └─ H1 선택 후 H2/H3 마스터 생성 (LLM)

POST /api/ingestion/analyze-tagging-samples
  └─ 샘플 청크 태깅 미리보기

POST /api/ingestion/apply-granular-tagging
  └─ 전체 청크 metadata.hierarchy_h1/h2/h3 일괄 업데이트
```

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

## Stage 7 — 평가 파이프라인

`evaluators/pipeline.py` — 4단계 순차 + 병렬 처리

| 레이어 | 이름        | 도구                                  | 설명                         |
| ------ | ----------- | ------------------------------------- | ---------------------------- |
| 1-A    | 구문 검증   | `SyntaxValidator`                   | JSON 형식·필수 필드 체크    |
| 1-B    | 통계 검증   | `DatasetStats`                      | 길이·다양성·중복 통계      |
| 2      | RAG Triad   | `RAGTriadEvaluator` + Claude Haiku  | 관련성·근거성·맥락성 (0~1) |
| 3      | 완전성 평가 | `QAQualityEvaluator` + Claude Haiku | 완전성 (0~1)                 |

### 평가 점수 구조

```
rag_avg     = avg(관련성, 근거성, 맥락성)
quality_avg = 완전성
unified     = (rag_avg × 3 + quality_avg) / 4
final_score = unified  (0~1, × 100 으로 % 표시)
```

### 평가 모델 워커 수

| Provider  | 모델             | 최대 workers |
| --------- | ---------------- | ------------ |
| Anthropic | Claude Haiku 4.5 | 2            |
| Google    | Gemini Flash     | 10           |
| OpenAI    | GPT-5.x          | 8            |

---

## 사용 라이브러리 요약

| 라이브러리                   | 역할                               | 비고                          |
| ---------------------------- | ---------------------------------- | ----------------------------- |
| `PyMuPDF (fitz)`           | PDF 텍스트·블록 추출              |                               |
| `python-docx`              | DOCX XML 파싱 (단락/표/제목)       | `docx2txt` 미사용           |
| `google-genai`             | Gemini 임베딩·청킹 LLM            | Gemini 2.5 Flash, Embedding 2 |
| `langchain-text-splitters` | `RecursiveCharacterTextSplitter` | rule 청킹 경로에서만 사용     |
| `supabase-py`              | pgvector DB 연동                   |                               |
| `anthropic`                | Claude Haiku 평가                  | RAG Triad + 완전성            |
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
├── evaluators/
│   ├── pipeline.py            # 4-Layer 평가 오케스트레이터
│   ├── rag_triad.py           # RAG Triad 평가
│   └── qa_quality.py          # 완전성 평가
├── db/
│   └── hierarchy_repo.py      # H1/H2/H3 드롭다운 필터 (MIN_CHUNKS/CHARS)
└── scripts/
    └── setup_vector_db.sql    # pgvector 테이블·인덱스·RPC 정의
```
