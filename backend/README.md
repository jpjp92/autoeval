# AutoEval Backend

FastAPI 기반 QA 생성·평가 백엔드.
문서 인제스션부터 적응형 QA 생성, 4레이어 평가까지 처리한다.

---

## 디렉토리 구조

```
backend/
├── main.py                      # FastAPI 앱 + 라우트 통합 허브 + 로깅 설정
├── api/                         # API 라우트 레이어
│   ├── generation_api.py        # POST /api/generate — 생성 job 관리 + 2단계 흐름
│   ├── evaluation_api.py        # POST /api/evaluate — 4레이어 평가 job 관리
│   └── ingestion_api.py         # POST /api/ingestion/* — 문서 인제스션 + hierarchy 태깅
├── generators/                  # QA 생성 핵심 로직
│   ├── qa_generator.py          # generate_qa() — 프로바이더별 API 호출 (Claude/Gemini/GPT)
│   └── domain_profiler.py       # analyze_domain() — doc_chunks 샘플 → LLM 도메인 분석
├── evaluators/                  # 4레이어 평가 로직
│   ├── pipeline.py              # 평가 파이프라인 오케스트레이션 + Supabase 저장
│   ├── syntax_validator.py      # Layer 1-A: 구문 검증
│   ├── dataset_stats.py         # Layer 1-B: 다양성·중복률 통계
│   ├── rag_triad.py             # Layer 2: RAG Triad (Relevance/Groundedness/Clarity)
│   └── qa_quality.py            # Layer 3: Quality Score (Factuality/Completeness)
├── config/
│   ├── supabase_client.py       # Supabase 클라이언트 + 저장/조회 함수
│   ├── prompts.py               # 프롬프트 상수 + 적응형 빌더 (build_system_prompt 등)
│   ├── models.py                # 모델 alias → model_id, cost, provider 매핑
│   └── constants.py             # 경로, worker 수 등 기본 상수
├── scripts/
│   ├── setup_vector_db.sql      # doc_chunks 테이블 + match_doc_chunks RPC
│   └── setup_qa_eval_tables.sql # qa_eval_results, qa_gen_results, 뷰 2개
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
SUPABASE_KEY=...
```

## 실행

```bash
# uv (권장)
uv sync
uv run main.py

# 또는 pip
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API 문서: `http://localhost:8000/docs`

---

## API 엔드포인트

### Ingestion  `/api/ingestion`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/upload` | PDF/DOCX 업로드 → 청킹 → 임베딩 → doc_chunks 저장 |
| `POST` | `/analyze-hierarchy` | 업로드 문서 L1 후보 + 계층 제안 |
| `POST` | `/analyze-tagging-samples` | L2/L3 AI 태깅 샘플 미리보기 |
| `POST` | `/apply-granular-tagging` | doc_chunks.metadata hierarchy 일괄 적용 |
| `POST` | `/update-hierarchy` | 단일 청크 계층 수동 업데이트 |
| `GET`  | `/hierarchy-list` | DB L1/L2 고유 목록 반환 (드롭다운용) |

### Generation  `/api/generate`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/` | QA 생성 job 시작 (domain_profiler → 적응형 프롬프트 → 병렬 생성) |
| `GET`  | `/{job_id}/status` | 생성 job 진행 상태 조회 |
| `GET`  | `/jobs` | 전체 job 목록 |
| `DELETE` | `/{job_id}` | job 취소 |

### Evaluation  `/api/evaluate`

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/` | 4레이어 평가 job 시작 |
| `GET`  | `/{job_id}/status` | 평가 job 진행 상태 + 레이어별 결과 |

### System

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스체크 |
| `GET` | `/api/results` | 로컬 결과 파일 목록 |
| `GET` | `/api/results/{filename}` | 특정 결과 파일 상세 |
| `POST` | `/api/export` | 결과 내보내기 (CSV/HTML/XLSX/JSON) |

---

## 생성 파이프라인 흐름

```
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
Layer 2    RAG Triad               Relevance / Groundedness / Clarity (TruLens + LangChain judge)
Layer 3    Quality Score           Factuality / Completeness (LLM judge)

final_score = syntax*0.2 + stats*0.2 + rag*0.3 + quality*0.3
등급: A+(≥0.92) / A(≥0.85) / B+(≥0.75) / B(≥0.65) / C(≥0.50) / F(<0.50)
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
