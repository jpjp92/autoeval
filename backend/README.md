# AutoEval Backend

FastAPI 기반 QA 생성·평가 백엔드.
문서 인제스션부터 적응형 QA 생성, 4레이어 평가까지 처리한다.

---

## 디렉토리 구조

```
backend/
├── main.py                      # FastAPI 앱 + 라우트 통합 허브 + 로깅 설정
├── api/                         # API 라우트 레이어
│   ├── ingestion_api.py         # POST /api/ingestion/* — 업로드·청킹·hierarchy 분석·태깅
│   ├── generation_api.py        # POST /api/generate — QA 생성 job 관리
│   └── evaluation_api.py        # POST /api/evaluate — 4레이어 평가 job 관리
├── ingestion/                   # 인제스션 순수 함수 (I/O 없음)
│   ├── parsers.py               # PDF/DOCX 파싱·정규화·필터·청킹 전 처리
│   ├── llm_chunker.py           # LLM 청킹 — Gemini 2.5 Flash 기반 의미 단위 청킹
│   │                            #   PDF: SYSTEM_PROMPT (noise_correction 포함)
│   │                            #   DOCX: DOCX_SYSTEM_PROMPT (noise_correction 없음)
│   │                            #   파라미터: PDF=페이지 수 기반, DOCX=블록 수 기반 티어 자동 조정
│   ├── prompts.py               # LLM 프롬프트 빌더 — build_hierarchy_prompt / build_tagging_prompt
│   ├── tagging.py               # 배치 태깅 코루틴 — run_tagging(), _is_admin_anchor()
│   ├── chunker.py               # LLM/Rule-based 청킹 로직 — ingest_with_llm/rule_chunking()
│   └── pipeline.py              # 임베딩 → Supabase 저장 파이프라인 — process_and_ingest()
├── generators/                  # QA 생성 핵심 로직
│   ├── prompts.py               # 시스템 프롬프트·유저 템플릿 — SYSTEM_PROMPT_*/USER_TEMPLATE_*, build_system_prompt(), build_user_template()
│   ├── job_manager.py           # JobStatus, GenerationJob, JobManager, 전역 job_manager 싱글턴
│   ├── worker.py                # 생성 오케스트레이션 — run_qa_generation*(), 병렬 생성, Supabase 저장
│   ├── qa_generator.py          # generate_qa() — 프로바이더별 API 호출 (Claude/Gemini/GPT)
│   └── domain_profiler.py       # 폴백 전용 (/analyze-hierarchy 미실행 시만 호출)
├── evaluators/                  # 4레이어 평가 로직
│   ├── pipeline.py              # 평가 파이프라인 오케스트레이션 (ThreadPoolExecutor 병렬) + build_export_detail(), _classify_failure_types()
│   ├── syntax_validator.py      # Layer 1-A: 구문 검증
│   ├── dataset_stats.py         # Layer 1-B: 통계 분석 (다양성·중복·편향)
│   ├── rag_triad.py             # Layer 2: RAG Triad (관련성·근거성·맥락성)
│   ├── qa_quality.py            # Layer 3: 완전성 (Completeness, 질문 분해 기반)
│   ├── recommendations.py       # 평가 결과 기반 개선 권고 생성
│   └── job_manager.py           # in-memory 평가 job 관리
├── db/                          # Supabase Repository
│   ├── base_client.py           # 클라이언트 초기화
│   ├── doc_chunk_repo.py        # 청크 CRUD + vector 검색 + 배치 INSERT + patch_chunk_hierarchy RPC
│   ├── hierarchy_repo.py        # H1/H2/H3 목록 조회 (filter_for_qa 파라미터로 QA용/표시용 분기)
│   ├── doc_metadata_repo.py     # 문서 단위 메타 (domain_profile + h2_h3_master) upsert/조회
│   ├── qa_generation_repo.py    # QA 생성 결과 저장/조회
│   ├── evaluation_repo.py       # 평가 결과 저장/조회
│   ├── generation_eval_link.py  # 생성-평가 연결 (linked_evaluation_id)
│   └── dashboard_repo.py        # 대시보드 집계
├── config/
│   ├── supabase_client.py       # re-export wrapper → backend/db/ 위임
│   ├── prompts.py               # 호환성 shim — generators/prompts.py re-export
│   ├── models.py                # 모델 alias → model_id, cost, provider 매핑
│   └── constants.py             # worker 수 등 기본 상수
└── scripts/
    ├── setup_vector_db.sql          # doc_chunks 테이블 + match_doc_chunks / patch_chunk_hierarchy RPC
    ├── setup_qa_eval_tables.sql     # qa_eval_results, qa_gen_results + get_eval_qa_scores RPC
    ├── inspect_db_state.py          # 각 테이블 현황 점검
    ├── detect_cleanup_targets.py    # 구버전/고아 행 탐지 → cleanup_targets.json + cleanup_queries.sql
    ├── cleanup_targets.json
    └── cleanup_queries.sql
```

---

## 환경 설정

```bash
# backend/.env
GOOGLE_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
SUPABASE_URL=...
SUPABASE_API_KEY=...   # service_role 키
```

## 실행

```bash
# uv (권장)
uv sync
python -m uvicorn backend.main:app --reload

# 또는 pip
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

API 문서: `http://localhost:8000/docs`

---

## API 엔드포인트

### Ingestion  `/api/ingestion`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/upload` | PDF/DOCX 업로드 → 청킹 → 임베딩 → doc_chunks 저장 (`chunking_method`: `llm`(기본) \| `rule`) |
| `POST` | `/analyze-hierarchy` | anchor 30개 → LLM 1회 → H1/H2/H3 master + domain_profile 동시 생성 → doc_metadata 저장 |
| `POST` | `/analyze-tagging-samples` | 이미 태깅된 청크 샘플 조회 (`__admin__` 제외, H1 다양성 우선 5개) |
| `POST` | `/apply-granular-tagging` | 청크별 hierarchy 일괄 태깅 (batch=5, parallel=5, 완료 후 샘플 5개 반환) |
| `GET`  | `/hierarchy-list` | H1/H2/H3 고유 목록. `filter_for_qa=true`(기본, QA 드롭다운용) / `filter_for_qa=false`(표시용, 필터 없음) |

### Generation  `/api/generate`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/generate` | QA 생성 job 시작 |
| `GET`  | `/api/generate/{job_id}/status` | job 상태 (status / progress / result_id) |
| `GET`  | `/api/generate/{job_id}/preview` | 생성 완료 후 QA 미리보기 (기본 5개) |
| `GET`  | `/api/generate/jobs` | 세션 내 전체 job 목록 |
| `DELETE` | `/api/generate/{job_id}` | job 취소 |

**POST /api/generate request body**

```json
{
  "model":           "gemini-3.1-flash",
  "lang":            "ko",
  "samples":         8,
  "prompt_version":  "v1",
  "filename":        "document.pdf",
  "document_id":     "<doc_chunks.document_id>",
  "hierarchy_h1":    "대분류",
  "hierarchy_h2":    "중분류"
}
```

> `document_id` + `filename` 있으면 `sample_doc_chunks` RPC 균등 샘플링 후 h1/h2/h3 후처리 필터.
> `total_qa == 0`이면 저장 건너뛰고 job을 `FAILED`로 처리 (컨텍스트 부족 안내).

### Evaluation  `/api/evaluate`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/evaluate` | 4레이어 평가 job 시작 |
| `GET`  | `/api/evaluate/{job_id}/status` | 평가 job 상태 + 레이어별 결과 |
| `GET`  | `/api/evaluate/list` | 세션 내 평가 job 목록 |
| `GET`  | `/api/evaluate/history` | Supabase 과거 평가 이력 (최대 50건) |
| `GET`  | `/api/evaluate/{job_id}/export` | QA+점수 조인 내보내기 |
| `GET`  | `/api/evaluate/export-by-id/{eval_id}` | eval_id 기반 내보내기 (RPC `get_eval_qa_scores`) |

### System

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스체크 |
| `GET` | `/api/dashboard/metrics` | 대시보드 집계 (summary, recent_jobs, grade_dist, model_benchmarks) |

---

## 데이터 저장 방식

파일 시스템 저장 없음 — 모든 결과물은 Supabase에만 저장됨.

| 단계 | 테이블 | 비고 |
|------|--------|------|
| 문서 청크 | `doc_chunks` | content + embedding(1536) + metadata JSONB + document_id 컬럼 |
| 문서 메타 | `doc_metadata` | domain_profile + h2_h3_master (문서 단위, 1행) |
| QA 생성 결과 | `qa_gen_results` | qa_list JSONB + stats |
| QA 평가 결과 | `qa_eval_results` | pipeline_results JSONB + final_score + grade |

### `doc_chunks.metadata` 필드 목록

```json
{
  "filename":        "문서명.pdf",
  "page":            3,
  "chunk_index":     12,
  "total_chunks":    45,
  "chunk_type":      "body | table | heading | ...",
  "section_title":   "핵심 주제 제목 (LLM 생성)",
  "content_hash":    "sha1hex",
  "char_length":     412,
  "chunking_method": "llm | rule",
  "embedding_model": "gemini-embedding-2-preview",
  "ingested_at":     "2026-04-02T10:00:00",
  "source":          "pdf | docx",
  "hierarchy_h1":    "대분류",
  "hierarchy_h2":    "중분류",
  "hierarchy_h3":    "소분류"
}
```

> `document_id`는 `metadata`가 아닌 전용 컬럼(`doc_chunks.document_id`)에 저장.
> `section_path`, `section_level`은 제거됨 (2026-04-02, 데드 필드).

---

## 인제스션 파이프라인 흐름

```
PDF/DOCX 업로드
  └─ doc_id = uuid4()
      └─ upsert_doc_metadata(doc_id, filename)   # FK 제약 충족을 위해 최소 row 선점
          └─ extract_text_by_page()
              ├─ PDF  → PyMuPDF 블록 단위 추출
              └─ DOCX → python-docx XML 직접 파싱 (단락/표/제목 구조 보존)
                  ├─ [llm]  run_llm_chunking() / run_llm_chunking_docx()  (기본)
                  │         Gemini 2.5 Flash, 배치 병렬, 의미 단위 청크
                  │         DOCX: 블록 수 기반 티어(S/M/L/XL) 자동 조정
                  └─ [rule] build_sections → chunk_blocks_aware  (하위 호환)
                      └─ 공통 필터 (toc / colophon / symbol / too_short / dedup)
                          └─ Gemini Embedding 2 (1536차원, L2 정규화)
                              └─ Supabase doc_chunks 저장
                                 metadata: filename/page/chunk_type/section_title/...
                                 document_id: 전용 컬럼

Pass 2: /analyze-hierarchy
  anchor 30개 샘플링 → LLM 1회 → H1/H2/H3 master + domain_profile 동시 생성
  TEXT QUALITY RULE 적용: PDF 노이즈 텍스트를 H1/H2/H3에 복사하지 않도록 제어
  → doc_metadata upsert

Pass 3: /apply-granular-tagging
  청크별 hierarchy 태깅 (batch=5, parallel=5, 세마포어 제한)
  master_hierarchy 준수 — EXCLUSIVELY 선택, 신규 생성 금지
  patch_chunk_hierarchy RPC: hierarchy 3개 필드만 jsonb merge (페이로드 최소화)
  실패 시 최대 3회 지수 백오프 재시도

/hierarchy-list
  filter_for_qa=true  → MIN_CHUNKS_FOR_QA=2 + MIN_CONTENT_CHARS=300 필터 적용 (QA 드롭다운)
  filter_for_qa=false → 필터 없이 전체 태깅 결과 반환 (카테고리 구조 트리 표시용)
```

---

## QA 생성 파이프라인 흐름

```
청크 조회
  document_id + filename → sample_doc_chunks RPC 균등 샘플링 → h1/h2/h3 후처리 필터
  fallback: get_doc_chunks_by_filter(document_id 컬럼 기반)

  청크 필터:
    - chunk_type=heading / __admin__ / colophon → skip
    - hierarchy_h1=None (태깅 미완료) → skip + WARNING
    - 결과 0건 + hierarchy 필터 있으면 → ValueError

도메인 프로파일 로드
  doc_metadata에서 조회 (document_id → filename 순 fallback)
  없으면 domain_profiler.analyze_domain() 폴백

청크별 QA 생성 (ThreadPoolExecutor 병렬)
  build_system_prompt() + build_user_template() → generate_qa()
  total_qa == 0 → job FAILED 처리, DB 저장 건너뜀
  total_qa > 0  → qa_gen_results 저장
```

---

## 평가 파이프라인 흐름 (4-Layer)

| 레이어 | 모듈 | 역할 | 가중치 |
| :--- | :--- | :--- | :--- |
| L1-A Syntax | `syntax_validator.py` | 구문 정확성 (필드 존재, 길이 범위) | 5% |
| L1-B Stats | `dataset_stats.py` | 데이터셋 통계 (다양성·중복·편향) | 5% |
| L2 RAG Triad | `rag_triad.py` | 관련성·근거성·맥락성 (LLM Judge) | 65% |
| L3 Quality | `qa_quality.py` | 완전성 — 질문 분해 기반 커버리지 | 25% |

### 최종 점수 산식

```
unified     = (rag_avg × 3 + quality_avg) / 4
final_score = (Syntax×0.05) + (Stats×0.05) + (Triad_Avg×0.65) + (Completeness×0.25)
```

**등급**: A+(≥0.95) / A(≥0.85) / B+(≥0.75) / B(≥0.65) / C(≥0.50) / F(<0.50)

### 상태 판정

| 상태 | 조건 |
|------|------|
| Fail | 품질 점수 AND RAG Triad 점수 모두 0.7 미만 |
| Hold | 0.7 미만 지표 1개 이상, 또는 0.7 이상이나 근거 오류/환각 감지 |
| Pass | 모든 점수 ≥ 0.7, 결함 없음 |

---

## 모델 구성

### 생성 모델

| alias | model_id | provider | Workers |
|-------|----------|----------|---------|
| `gemini-3.1-flash` | gemini-3-flash-preview | google | 5 |
| `gpt-5.2` | gpt-5.2-2025-12-11 | openai | 5 |
| `claude-sonnet` | claude-sonnet-4-6 | anthropic | 2 |

### 평가 모델 (기본값: `gemini-flash`)

| alias | model_id | provider | Workers |
|-------|----------|----------|---------|
| `gemini-flash` | gemini-2.5-flash | google | 10 |
| `gpt-5.1` | gpt-5.1-2025-11-13 | openai | 8 |
| `claude-haiku` | claude-haiku-4-5 | anthropic | 2 |

### 인제스션 모델

| 용도 | model_id | 비고 |
|------|----------|------|
| LLM 청킹 (PDF/DOCX) | gemini-2.5-flash | thinking_budget=0, temperature=0.1 |
| 임베딩 | gemini-embedding-2-preview | 1536차원, RETRIEVAL_DOCUMENT/QUERY |
| Hierarchy + domain_profile 생성 | gemini-3-flash-preview | H1/H2/H3 master + domain_profile 동시 생성 |
| Hierarchy 태깅 | gemini-3-flash-preview | batch=5, parallel=5, temperature=0 |

### domain_profile

`/analyze-hierarchy` 1회 LLM 호출에서 hierarchy와 동시 추출 → `doc_metadata` 저장.

```json
{
  "domain":           "AI 데이터 구축 가이드라인",
  "domain_short":     "AI 데이터",
  "target_audience":  "데이터 구축 작업자",
  "key_terms":        ["어노테이션", "품질관리", "데이터셋", "라벨링", "검수"],
  "tone":             "기술 문서 격식체"
}
```

---

## 주요 설계 결정 사항

| 항목 | 결정 | 이유 |
|------|------|------|
| DOCX 파싱 | `python-docx` XML 직접 파싱 | `docx2txt` 대비 표 구조 보존, Heading 계층 인식, Fallback 중복 방지 |
| LLM 청킹 기본 | Gemini 2.5 Flash | 의미 단위 경계 판단, noise_correction 포함 (PDF) |
| 임베딩 차원 | 1536 | HNSW 인덱스 2000차원 제한 고려 |
| document_id 저장 | `doc_chunks.document_id` 전용 컬럼 | metadata JSONB 중복 제거, 컬럼 인덱스 활용 |
| hierarchy-list 이중화 | `filter_for_qa` 파라미터 | QA 드롭다운(MIN_CHUNKS/CHARS 필터)과 표시용 트리(필터 없음) 분리 |
| 빈 QA 저장 방지 | `total_qa == 0` early return | 컨텍스트 부족 노드 선택 시 빈 레코드 DB 저장 방지 |
| H2/H3 최소 조건 | `MIN_CHUNKS=2`, `MIN_CONTENT_CHARS=300` | 청크 수와 실제 텍스트 길이를 모두 충족해야 드롭다운 노출 |
| `ingestion_api.py` 모듈화 | `prompts / tagging / chunker / pipeline` 분리 | 870줄 단일 파일 → 라우터 331줄 + 4개 전담 모듈, 프롬프트/태깅/청킹/파이프라인 독립 테스트 가능 |
| `generation_api.py` 모듈화 | `prompts / job_manager / worker` 분리 | 1006줄 단일 파일 → 라우터 224줄 + 3개 전담 모듈, 지연 import 워크어라운드 제거, `config/prompts.py` → `generators/prompts.py` 이동 |
| `config/prompts.py` 위치 이전 | `generators/prompts.py`로 이동, shim 유지 | generation 전용 프롬프트를 config 레이어에서 generators 레이어로 이동, 기존 코드 호환성 보장 |
| `evaluation_api.py` 정리 | `TYPE_CHECKING` 제거, `try/except ImportError` → `sys.path.insert` 통일, `_build_export_detail` → `evaluators/pipeline.build_export_detail` 이동 | 418줄 → 321줄, 이중 import 패턴 제거, export 헬퍼 비즈니스 로직을 evaluators 레이어로 귀속 |
