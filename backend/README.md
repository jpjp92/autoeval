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
│   └── parsers.py               # 파싱·정규화·필터·청킹 전 함수 (extract_text_by_page 등)
├── generators/                  # QA 생성 핵심 로직
│   ├── qa_generator.py          # generate_qa() — 프로바이더별 API 호출 (Claude/Gemini/GPT)
│   └── domain_profiler.py       # analyze_domain() — doc_chunks 샘플 → LLM 도메인 분석
├── evaluators/                  # 4레이어 평가 로직
│   ├── pipeline.py              # 평가 파이프라인 오케스트레이션 — _classify_failure_types() + reason/failure 필드 qa_preview 빌드
│   ├── syntax_validator.py      # Layer 1-A: 구문 검증
│   ├── dataset_stats.py         # Layer 1-B: 다양성·중복률 통계
│   ├── rag_triad.py             # Layer 2: RAG Triad — evaluate_all_with_reasons() 단일 호출 (score + reason 반환)
│   ├── qa_quality.py            # Layer 3: Quality Score — factuality/completeness/specificity/conciseness + reason 반환
│   ├── recommendations.py       # 평가 결과 기반 개선 권고 생성
│   └── job_manager.py           # in-memory 평가 job 관리
├── db/                          # Supabase Repository 패키지
│   ├── base_client.py           # 클라이언트 초기화, require_client(), health_check()
│   ├── qa_generation_repo.py    # QA 생성 결과 저장/조회
│   ├── evaluation_repo.py       # 평가 결과 저장/조회
│   ├── generation_eval_link.py  # 생성-평가 연결 (linked_evaluation_id)
│   ├── doc_chunk_repo.py        # 문서 청크 CRUD + vector 검색 + save_doc_chunks_batch() 배치 INSERT
│   ├── hierarchy_repo.py        # 계층 목록 조회 / 일괄 업데이트
│   └── dashboard_repo.py        # 대시보드 집계 (summary, recent_jobs+eval_id, grade_dist) + get_distinct_doc_count RPC
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
| `POST` | `/upload` | PDF/DOCX 업로드 → 청킹 → 임베딩 → doc_chunks 저장 |
| `POST` | `/analyze-hierarchy` | Pass 1 — doc_chunks 샘플 → H1 master 3~5개 도출 |
| `POST` | `/analyze-h2-h3` | Pass 2 — H1 기반 H2/H3 master 동시 생성 |
| `POST` | `/analyze-tagging-samples` | 태깅 적용 전 3~5개 청크 미리보기 |
| `POST` | `/apply-granular-tagging` | Pass 3 — 청크별 hierarchy 일괄 적용 |
| `GET`  | `/hierarchy-list` | DB H1/H2/H3 고유 목록 반환 (드롭다운용) |

### Generation  `/api/generate`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/generate` | QA 생성 job 시작 (domain_profiler → 적응형 프롬프트 → 병렬 생성) |
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
| QA 생성 결과 | `qa_gen_results` | qa_list JSONB + stats |
| QA 평가 결과 | `qa_eval_results` | pipeline_results JSONB + final_score + grade |

`result_filename` 필드(예: `qa_gemini_ko_v1_20260323_123456.json`)는 job 식별용 레이블로만 사용되며, 실제 파일로 디스크에 쓰이지 않음.  
`output/` 디렉토리의 `.json` 파일들은 초기 개발(test/backup) 시절 산물.

---

```
[사전] 청크 조회
    hierarchy_h1/h2/h3 필터 → get_doc_chunks_by_filter()
    결과 0건 + filename 있으면 → filename-only 재쿼리 (구버전 청크 대응)

[1단계] 도메인 분석 (job당 1회)
    doc_chunks 샘플 (최대 10개) → domain_profiler.analyze_domain()
    → domain_profile { domain, target_audience, key_terms, chunk_type_dist, intent_hints }

[2단계] 청크별 QA 생성 (ThreadPoolExecutor 병렬)
    chunk_type 감지 → build_system_prompt() + build_user_template()
    → generate_qa() (Claude / Gemini / GPT)
    → qa_gen_results Supabase 저장
```

## 평가 파이프라인 흐름

```
Layer 1-A  Syntax Validation      구문 정확성 (answerable 필드, Q/A 길이 등)
Layer 1-B  Dataset Statistics     다양성·중복률 (SequenceMatcher 기반)
Layer 2    RAG Triad               Relevance / Groundedness / Clarity — 단일 LLM 호출로 score + reason 반환
Layer 3    Quality Score           Factuality / Completeness / Specificity / Conciseness — intent-aware, score + reason 반환
           failure 분류             _classify_failure_types() — 차원 점수 기반 failure_types[] + primary_failure 자동 결정

final_score = syntax*0.1 + stats*0.1 + rag*0.4 + quality*0.4
등급: A+(≥0.95) / A(≥0.85) / B+(≥0.75) / B(≥0.65) / C(≥0.50) / F(<0.50)
```

---

## 모델 구성

### 생성 모델

| alias | model_id | provider | Workers |
|-------|----------|----------|---------|
| `gemini-3.1-flash` | gemini-3-flash-preview | google | 5 |
| `gpt-5.2` | gpt-5.2-2025-12-11 | openai | 5 |
| `claude-sonnet` | claude-sonnet-4-6 | anthropic | 2 |

### 평가 모델 (기본값: `gemini-2.5-flash`)

| alias | model_id | provider | Workers |
|-------|----------|----------|---------|
| `gemini-2.5-flash` | gemini-2.5-flash | google | 10 |
| `gpt-5.1` | gpt-5.1-2025-11-13 | openai | 8 |
| `claude-haiku` | claude-haiku-4-5 | anthropic | 2 |
