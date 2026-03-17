# AutoEval: QA 생성 및 평가 시스템

**LLM 기반 자동 QA 생성, 계층형 컨텍스트 관리 및 멀티 모델 평가 플랫폼**

> **Gemini Embedding 2**와 **Supabase Vector DB**를 활용하여 문서 인제스션부터 계층별 QA 생성, 4레이어 정밀 평가까지 제공하는 엔드-투-엔드 시스템

---

## 목차

1. [시스템 워크플로우](#-시스템-워크플로우)
2. [핵심 기술 스택](#-핵심-기술-스택)
3. [모델 구성 및 Rate Limit](#-모델-구성-및-rate-limit)
4. [DB 스키마](#-db-스키마)
5. [빠른 시작](#-빠른-시작)
6. [디렉토리 구조](#-디렉토리-구조)
7. [개발 노트](#-개발-노트)

---

## 시스템 워크플로우

```
[1] 데이터 규격화 (Standardization)
    PDF/DOCX 업로드 → PyMuPDF 파싱 → Section-First 청킹
    → normalize_text (Ÿ 정규화, 줄바꿈 결합, 짧은 청크 병합)
    → Gemini Embedding 2 벡터화 → Supabase doc_chunks 저장
    (content_hash 기반 중복 방지)

[2] 계층 태깅 (Hierarchy Tagging)
    AI 기반 L1/L2/L3 계층 분석 → doc_chunks.metadata 업데이트
    → 프론트엔드 L1/L2 드롭다운으로 QA 생성 범위 지정

[3] QA 생성 (Generation)
    L1/L2 필터 → doc_chunks 직접 조회 (vector similarity 없음)
    → heading/colophon 청크 skip
    → [도메인 분석] doc_chunks 샘플 → LLM → domain_profile (job당 1회)
    → domain_profile 기반 적응형 프롬프트 빌드 (chunk_type별 intent 분기)
    → ThreadPoolExecutor 병렬 QA 생성 → qa_gen_results 저장

[4] 4레이어 평가 (Evaluation)
    Layer 1-A: Syntax Validation
    Layer 1-B: Dataset Statistics (다양성, 중복률)
    Layer 2:   RAG Triad (Relevance / Groundedness / Clarity)
    Layer 3:   Quality Score (Factuality / Completeness)
    → qa_eval_results 저장 + qa_gen_results.linked_evaluation_id 업데이트
```

---

## 핵심 기술 스택

| 영역 | 기술 |
|------|------|
| **Frontend** | React 19, TypeScript, Tailwind CSS, Lucide icons |
| **Backend** | FastAPI (Python 3.12+), Uvicorn, uv |
| **Database** | Supabase (PostgreSQL 15 + pgvector) |
| **Embeddings** | Gemini Embedding 2 (`gemini-embedding-2-preview`) — 1536dim, L2 정규화 |
| **Orchestration** | Custom JobManager + ThreadPoolExecutor 병렬 처리 |

---

## 모델 구성 및 Rate Limit

### QA 생성 모델

| 모델 | API 명 | RPM | TPM | Workers |
|------|--------|-----|-----|---------|
| **GPT-5.2** | gpt-5.2-2025-12-11 | 500 | 500K | 5 |
| **Gemini 3.1 Flash** | gemini-3-flash-preview | 1,000 | 2M | 5 |
| **Claude Sonnet 4.6** | claude-sonnet-4-6 | 50 | 30K | 2 |

### 평가 모델

| 모델 | API 명 | RPM | TPM | Workers |
|------|--------|-----|-----|---------|
| **GPT-5.1** | gpt-5.1-2025-11-13 | 500 | 500K | 8 |
| **Gemini 2.5 Flash** | gemini-2.5-flash | 1,000 | 1M | 10 |
| **Claude Haiku 4.5** | claude-haiku-4-5 | 50 | 50K | 2 |

---

## DB 스키마

Supabase 3개 테이블 + 2개 뷰. 상세 스키마: [DBINFO.md](DBINFO.md)

| 객체 | 유형 | 설명 |
|------|------|------|
| `doc_chunks` | 테이블 | 문서 청크 + Gemini 임베딩 (HNSW 인덱스) |
| `qa_gen_results` | 테이블 | QA 생성 결과 (job별 qa_list JSONB 중첩) |
| `qa_eval_results` | 테이블 | 4레이어 평가 결과 + 최종 등급 |
| `qa_pairs_view` | 뷰 | qa_gen_results.qa_list를 flat하게 펼친 QA 샘플 확인용 |
| `evaluation_qa_joined` | 뷰 | qa_eval_results ↔ qa_gen_results 조인 |

### 최종 등급 체계

```
final_score = syntax*0.2 + stats*0.2 + rag*0.3 + quality*0.3

A+ (≥0.92) / A (≥0.85) / B+ (≥0.75) / B (≥0.65) / C (≥0.50) / F (<0.50)
```

---

## 빠른 시작

### 1. 환경 설정

```bash
# Python 환경 (uv 권장)
cd backend && uv sync

# Node
cd frontend && npm install
```

### 2. 환경 변수

```bash
# backend/.env
GOOGLE_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
SUPABASE_URL=...
SUPABASE_API_KEY=...   # anon 또는 service_role 키
```

### 3. DB 초기화 (최초 1회)

Supabase SQL Editor에서 순서대로 실행:

```
backend/scripts/setup_vector_db.sql       # doc_chunks + match_doc_chunks RPC
backend/scripts/setup_qa_eval_tables.sql  # qa_eval_results, qa_gen_results, 뷰 2개
```

### 4. 실행

```bash
# Backend
cd backend && uv run main.py

# Frontend (별도 터미널)
cd frontend && npm run dev
```

---

## 디렉토리 구조

```
autoeval/
├── backend/
│   ├── main.py                      # FastAPI 허브 — api/* 라우트 통합 + 로깅 설정
│   ├── api/                         # API 라우트 레이어
│   │   ├── generation_api.py        # POST /api/generate — 생성 job 관리 + 2단계 흐름
│   │   ├── evaluation_api.py        # POST /api/evaluate — 4레이어 평가 job 관리
│   │   └── ingestion_api.py         # POST /api/ingestion/* — 문서 인제스션 + hierarchy
│   ├── generators/                  # QA 생성 핵심 로직
│   │   ├── qa_generator.py          # generate_qa() — 프로바이더별 API 호출 (Claude/Gemini/GPT)
│   │   └── domain_profiler.py       # analyze_domain() — doc_chunks 샘플 → LLM 도메인 분석
│   ├── evaluators/                  # 4레이어 평가 로직
│   │   ├── pipeline.py              # 평가 파이프라인 + Supabase 저장
│   │   ├── syntax_validator.py      # Layer 1-A: 구문 검증
│   │   ├── dataset_stats.py         # Layer 1-B: 다양성·중복률 통계
│   │   ├── rag_triad.py             # Layer 2: RAG Triad (Relevance/Groundedness/Clarity)
│   │   └── qa_quality.py            # Layer 3: Quality Score (Factuality/Completeness)
│   ├── config/
│   │   ├── supabase_client.py       # DB 클라이언트 + 저장/조회 함수
│   │   ├── prompts.py               # 프롬프트 상수 + 적응형 빌더 (build_system_prompt 등)
│   │   ├── models.py                # 모델 alias → model_id, cost 매핑
│   │   └── constants.py             # 경로, worker 수 등 기본 상수
│   └── scripts/
│       ├── setup_vector_db.sql      # doc_chunks 테이블 + match_doc_chunks RPC
│       └── setup_qa_eval_tables.sql # qa_eval_results, qa_gen_results, 뷰 2개
│
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── lib/api.ts               # 백엔드 API 클라이언트
│       └── components/
│           ├── standardization/     # 문서 업로드 + 계층 태깅 UI
│           ├── generation/          # QA 생성 UI (L1/L2 드롭다운)
│           └── evaluation/          # 평가 결과 UI
│
├── DBINFO.md                        # DB 스키마 상세 문서
├── DEV_260317.md                    # 개발 세션 로그 (2026-03-17)
├── DEV_PRIORITY.md                  # 수정 우선순위 (P0~P4)
├── DEV_PROMPT_ADAPTIVE.md           # 적응형 프롬프트 설계 문서
└── README.md
```

---

## 개발 노트

### 완료 항목 (2026-03-17)

| 항목 | 내용 |
|------|------|
| **DB 스키마 통일** | 테이블명 `qa_eval_results`, `qa_gen_results` 정립 + 뷰 2개 추가 |
| **content_hash 중복 방지** | 재업로드 시 동일 청크 INSERT skip (SHA-1 기반) |
| **Ingestion 품질** | `Ÿ` 정규화, 문장 줄바꿈 결합, 짧은 청크 병합, colophon 필터 |
| **DB 청크 조회 전환** | dummy zero vector 제거 → `get_doc_chunks_by_filter()` 직접 select |
| **heading/colophon skip** | 생성 단계에서 제목 전용·발행처 청크 제외 |
| **프롬프트 범용화** | 통신사 도메인 하드코딩 제거 → 범용 QA 전문가 프롬프트 |
| **P3 적응형 프롬프트** | `domain_profiler.py` 도메인 분석 + `prompts.py` 빌더화 (chunk_type별 intent 분기) |
| **TruLens 로그 억제** | `logging.getLogger("trulens").setLevel(logging.ERROR)` 적용 |
| **백엔드 디렉토리 분리** | `api/` (라우트) + `generators/` (생성 로직) 구조로 리팩토링 |
| **E2E 검증** | doc_chunks 11개 / avg 773자 / 생성·평가·링크 전체 동작 확인 |

### 다음 작업

| 우선순위 | 항목 |
|---------|------|
| P3 | 적응형 프롬프트 E2E 테스트 — domain_profile 로그 확인 |
| P4 | 키 불일치 수정: `m.get("pages")` → `m.get("page")`, `m.get("type")` → `m.get("chunk_type")` |

---

**Last Updated**: 2026-03-17 | **Branch**: main
