# AutoEval Backend

FastAPI 기반 QA 생성·평가 백엔드.
문서 인제스션부터 적응형 QA 생성, 4레이어 평가까지 처리한다.

---

## 디렉토리 구조

```
backend/
├── main.py                      # FastAPI 앱 + 라우트 통합 허브 + 로깅 설정
├── api/                         # API 라우트 레이어 (얇은 라우터 전용)
│   ├── ingestion_api.py         # POST /api/ingestion/* — 라우터 + process_and_ingest
│   ├── generation_api.py        # POST /api/generate — 생성 job 관리 + 2단계 흐름
│   └── evaluation_api.py        # POST /api/evaluate — 4레이어 평가 job 관리
├── ingestion/                   # 인제스션 순수 함수 (I/O 없음)
│   ├── parsers.py               # 파싱·정규화·필터·청킹 전 함수 (extract_text_by_page 등)
│   └── llm_chunker.py           # LLM 청킹 모듈 — Gemini 2.5 Flash 기반 의미 단위 청킹
├── generators/                  # QA 생성 핵심 로직
│   ├── qa_generator.py          # generate_qa() — 프로바이더별 API 호출 (Claude/Gemini/GPT)
│   └── domain_profiler.py       # analyze_domain() — 폴백 전용 (/analyze-hierarchy 미실행 시만 호출)
│                                #   정상 플로우: /analyze-hierarchy에서 domain_profile 생성 → doc_metadata 저장 → 재사용
├── evaluators/                  # 4레이어 평가 로직
│   ├── pipeline.py              # 평가 파이프라인 오케스트레이션
│   ├── syntax_validator.py      # Layer 1-A: 구문 검증 (answerable 필드, Q/A 길이 등)
│   ├── dataset_stats.py         # Layer 1-B: 다양성·중복률 통계 (SequenceMatcher)
│   ├── rag_triad.py             # Layer 2: RAG Triad — relevance/groundedness/context_relevance (score + reason)
│   ├── qa_quality.py            # Layer 3: Quality Score — completeness 단일 지표 (intent-aware, score + reason)
│   ├── recommendations.py       # 평가 결과 기반 개선 권고 생성
│   └── job_manager.py           # in-memory 평가 job 관리
├── db/                          # Supabase Repository 패키지
│   ├── base_client.py           # 클라이언트 초기화, require_client(), health_check()
│   ├── qa_generation_repo.py    # QA 생성 결과 저장/조회
│   ├── evaluation_repo.py       # 평가 결과 저장/조회
│   ├── generation_eval_link.py  # 생성-평가 연결 (linked_evaluation_id)
│   ├── doc_chunk_repo.py        # 문서 청크 CRUD + vector 검색 + save_doc_chunks_batch() 배치 INSERT
│   ├── hierarchy_repo.py        # 계층 목록 조회 / 일괄 업데이트
│   ├── doc_metadata_repo.py     # 문서 단위 메타 (domain_profile + h2_h3_master) upsert/조회
│   └── dashboard_repo.py        # 대시보드 집계 (summary, recent_jobs+eval_id, grade_dist)
├── config/
│   ├── supabase_client.py       # re-export wrapper → backend/db/ 위임 (하위 호환)
│   ├── prompts.py               # 프롬프트 상수 + 적응형 빌더 (build_system_prompt 등)
│   ├── models.py                # 모델 alias → model_id, cost, provider 매핑
│   └── constants.py             # worker 수 등 기본 상수
├── scripts/
│   ├── setup_vector_db.sql      # doc_chunks 테이블 + match_doc_chunks RPC
│   └── setup_qa_eval_tables.sql # qa_eval_results, qa_gen_results + get_eval_qa_scores RPC
└── requirements.txt
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
| `POST` | `/analyze-hierarchy` | Pass 1+2 통합 — anchor 30개 → LLM 1회 → H1/H2/H3 master + domain_profile 동시 생성 → doc_metadata 저장 |
| `POST` | `/apply-granular-tagging` | Pass 3 — 청크별 hierarchy 일괄 적용 (완료 후 샘플 5개 반환) |
| `GET`  | `/hierarchy-list` | DB H1/H2/H3 고유 목록 반환 (드롭다운용) |

### Generation  `/api/generate`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/generate` | QA 생성 job 시작 (doc_metadata에서 domain_profile 조회 → 적응형 프롬프트 → 병렬 생성) |
| `GET`  | `/api/generate/{job_id}/status` | 생성 job 상태 (status / progress / result_id) |
| `GET`  | `/api/generate/{job_id}/preview` | 생성 완료 후 QA 미리보기 (기본 5개, context snippet 포함) |
| `GET`  | `/api/generate/jobs` | 세션 내 전체 job 목록 (status 필터 + limit 지원) |
| `DELETE` | `/api/generate/{job_id}` | job 취소 (completed 상태는 취소 불가) |

**POST /api/generate request body**

```json
{
  "model":           "gemini-3.1-flash",
  "lang":            "ko",
  "samples":         8,
  "prompt_version":  "v1",
  "filename":        "document.pdf",
  "hierarchy_h1":    "대분류",
  "hierarchy_h2":    "중분류"
}
```

> `filename` + `hierarchy_h1/h2/h3`는 청크 필터 조건. 모두 생략 시 전체 청크에서 생성.

### Evaluation  `/api/evaluate`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/evaluate` | 4레이어 평가 job 시작 |
| `GET`  | `/api/evaluate/{job_id}/status` | 평가 job 상태 + 레이어별 결과 (eval_report 포함) |
| `GET`  | `/api/evaluate/list` | 세션 내 평가 job 목록 (in-memory, 최신순) |
| `GET`  | `/api/evaluate/history` | Supabase qa_eval_results 과거 평가 이력 (최대 50건) |
| `GET`  | `/api/evaluate/{job_id}/export` | 세션 job QA+점수 조인 내보내기 (reason + failure_types + primary_failure 포함) |
| `GET`  | `/api/evaluate/export-by-id/{eval_id}` | Supabase eval_id 기반 내보내기 — RPC `get_eval_qa_scores`로 qa_scores만 추출 |

**POST /api/evaluate request body**

```json
{
  "result_filename": "qa_model_lang_v1_YYYYMMDD_HHmmss.json",
  "evaluator_model": "gemini-2.5-flash",
  "generation_id":   "<qa_gen_results.id>",
  "limit":           null
}
```

> `result_filename` 필수 (job 식별용 레이블, **실제 파일이 아님** — 파일 시스템에 저장되지 않음).
> `generation_id` 필수: QA 데이터를 Supabase `qa_gen_results`에서 조회하는 기준. 없으면 평가 불가.
> `evaluator_model` 기본값: `gemini-2.5-flash`.

### System

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스체크 |
| `GET` | `/api/dashboard/metrics` | 대시보드 집계 데이터 (Supabase) |

---

## 데이터 저장 방식

**파일 시스템 저장 없음** — 모든 중간 결과물은 Supabase에만 저장됨.

| 단계 | 저장 위치 | 비고 |
|------|----------|------|
| 문서 청크 | `doc_chunks` | content + embedding + metadata JSONB |
| 문서 메타 | `doc_metadata` | domain_profile + h2_h3_master (문서 단위, 1행) |
| QA 생성 결과 | `qa_gen_results` | qa_list JSONB + stats |
| QA 평가 결과 | `qa_eval_results` | pipeline_results JSONB + final_score + grade |

`doc_chunks.metadata`에 `chunking_method` 필드가 포함되어 청킹 방식 추적 가능 (`"llm"` 또는 `"rule"`).

`result_filename` 필드(예: `qa_gemini_ko_v1_20260323_123456.json`)는 job 식별용 레이블로만 사용되며, 실제 파일로 디스크에 쓰이지 않음.

---

## 인제스션 파이프라인 흐름

```
PDF/DOCX 업로드
  └─ extract_text_by_page()          # rawdict + 한글 공백 복원
      └─ 원시 블록 목록 (page, text)
          ├─ [llm]  run_llm_chunking()        # Gemini 2.5 Flash 배치 청킹 (기본)
          │         → merge_short / trim_dangling / dedup 후처리
          └─ [rule] build_sections → chunk_blocks_aware  (하위 호환)
              └─ 공통 필터 (toc / colophon / symbol / too_short / dedup)
                  └─ Gemini Embedding 2 (1536차원)
                      └─ Supabase doc_chunks 저장

Pass 2: /analyze-hierarchy
  anchor 30개 → LLM 1회 호출 → H1/H2/H3 master + domain_profile 동시 생성
  → doc_metadata 저장 (document_id 기준 upsert)

Pass 3: /apply-granular-tagging
  청크별 hierarchy 태깅 (batch=5, parallel=5)
```

---

## QA 생성 파이프라인 흐름

```
[사전] 청크 조회
    hierarchy_h1/h2/h3 필터 → get_doc_chunks_by_filter()
    결과 0건 + hierarchy 필터 있으면 → ValueError (Pass3 태깅 미완료 안내)

[1단계] 도메인 프로파일 로드
    doc_metadata에서 domain_profile 조회 (document_id → filename 순)
    캐시 있으면 즉시 사용 (LLM 호출 없음)
    캐시 없으면 → domain_profiler.analyze_domain() 폴백 (LLM 호출)

[2단계] 청크별 QA 생성 (ThreadPoolExecutor 병렬)
    domain_profile 기반 → build_system_prompt() + build_user_template()
    → generate_qa() (Claude / Gemini / GPT)
    → qa_gen_results Supabase 저장
```

---

## 평가 파이프라인 흐름

```
Layer 1-A  Syntax Validation      구문 정확성 (answerable 필드, Q/A 길이 등)
Layer 1-B  Dataset Statistics     다양성·중복률 통계 (SequenceMatcher 기반)
Layer 2    RAG Triad              Relevance / Groundedness / Context Relevance
                                  avg_score = relevance×0.3 + groundedness×0.5 + context_relevance×0.2
                                  단일 LLM 호출 → score + reason 반환
Layer 3    Quality Score          Completeness 단일 지표 (intent-aware)
                                  intent 유형(list/boolean/numeric/factoid 등)별 루브릭 적용
                                  score + completeness_reason 반환
           failure 분류            _classify_failure_types() — 점수 기반 failure_types[] + primary_failure 자동 결정

final_score = (syntax_pass_rate/100)×0.05 + (dataset_quality/10)×0.05 + rag_avg×0.65 + completeness×0.25
등급: A+(≥0.95) / A(≥0.85) / B+(≥0.75) / B(≥0.65) / C(≥0.50) / F(<0.50)
```

---

## 모델 구성

### 생성 모델

| alias | model_id | provider | Workers |
|-------|----------|----------|---------|
| `gemini-3.1-flash` | gemini-3-flash-preview | google | 5 |
| `gpt-5.2` | gpt-5.2-2025-12-11 | openai | 5 |
| `claude-sonnet` | claude-sonnet-4-6 | anthropic | 4 |

### 평가 모델 (기본값: `gemini-flash`)

| alias | model_id | provider | Workers |
|-------|----------|----------|---------|
| `gemini-flash` | gemini-2.5-flash | google | 10 |
| `gpt-5.1` | gpt-5.1-2025-11-13 | openai | 8 |
| `claude-haiku` | claude-haiku-4-5 | anthropic | 2 |

### 인제스션 모델

| 용도 | model_id | 비고 |
|------|----------|------|
| LLM 청킹 | gemini-2.5-flash | thinking_budget=0, temperature=0.1, 티어별 batch 자동 조정 |
| 임베딩 | gemini-embedding-2-preview | 1536차원, task_type=RETRIEVAL_DOCUMENT |
| Hierarchy + domain_profile 분석 (Pass 2) | gemini-3-flash-preview | H1/H2/H3 master + domain_profile 동시 생성, response_mime_type=application/json |
| Hierarchy 태깅 (Pass 3) | gemini-3-flash-preview | 청크별 분류, batch=5, parallel=5 |

### domain_profile

`/analyze-hierarchy` LLM 1회 호출에서 hierarchy와 동시 추출. `doc_metadata` 테이블에 저장.

```json
{
  "domain": "AI 데이터 구축 가이드라인",
  "domain_short": "AI 데이터",
  "target_audience": "데이터 구축 작업자",
  "key_terms": ["어노테이션", "품질관리", "데이터셋", "라벨링", "검수"],
  "tone": "기술 문서 격식체"
}
```

QA 생성 시 `doc_metadata`에서 조회하여 `build_system_prompt()` / `build_user_template()`에 전달.
`/analyze-hierarchy` 미실행 시 `domain_profiler.analyze_domain()`(폴백)으로 대체 — `GENERIC_DOMAIN_PROFILE` 반환.
