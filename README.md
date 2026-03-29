# AutoEval

**LLM 기반 QA 자동 생성 및 평가 POC 설계**

PDF/DOCX 문서를 업로드하면 계층 구조 분석 → QA 생성 → 4레이어 품질 평가까지 엔드-투-엔드로 처리합니다.

---

## 목차

1. [전체 플로우](#-전체-플로우)
2. [아키텍처](#-아키텍처)
3. [기술 스택](#-기술-스택)
4. [모델 구성](#-모델-구성)
5. [DB 스키마](#-db-스키마)
6. [빠른 시작](#-빠른-시작)
7. [API 엔드포인트](#-api-엔드포인트)
8. [배포 구성](#-배포-구성-render--vercel)

---

## 전체 플로우

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontSize": "13px", "lineColor": "#64748b", "primaryTextColor": "#1e293b"}}}%%
flowchart LR
    classDef doc fill:#f8fafc,stroke:#cbd5e1,color:#334155,stroke-width:2px
    classDef step fill:#e0e7ff,stroke:#6366f1,color:#1e293b,stroke-width:2px,rx:10,ry:10
    classDef core fill:#dbeafe,stroke:#3b82f6,color:#1e293b,stroke-width:2px,rx:10,ry:10
    classDef db fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95,stroke-dasharray: 4 4

    doc1([📄 PDF / DOCX 업로드]):::doc
    
    subgraph Data Standardization [Data Standardization]
        direction LR
        S1[LLM Chunking<br>노이즈 제거/정규화]:::step
        S2[계층 분석<br>H1/H2/H3 태깅]:::step
    end
    
    subgraph QA Generation [QA Pipeline]
        direction LR
        S3[계층기반 청크 필터<br>+ 도메인 프로파일]:::step
        S4[다중 모델<br>병렬 QA 생성]:::core
    end
    
    subgraph QA Evaluation [Evaluation]
        direction TB
        E1[L1: Syntax & Stats<br>L2: RAG Triad<br>L3: Quality 완전성]:::core
    end
    
    subgraph Result & Analytics [Dashboard & Export]
        direction LR
        R1[평가 리포트<br>Export]:::step
        R2[모델 성능<br>리더보드]:::step
    end
    
    DB1[(doc_chunks<br>doc_metadata)]:::db
    DB2[(qa_gen_results<br>qa_eval_results)]:::db

    doc1 --> S1
    S1 --> S2
    S2 -.벡터/메타 저장.-> DB1
    DB1 -.청크 조회.-> S3
    
    S3 --> S4
    S4 --> E1
    E1 -.결과 저장.-> DB2
    
    DB2 -.데이터 연동.-> R1 & R2
```

---

### 단계별 상세

#### STEP 1 — 데이터 규격화

| 처리 | 내용 |
|------|------|
| 파싱 | PDF(PyMuPDF) / DOCX(python-docx) — 원시 블록 추출 (`extract_text_by_page`) |
| 청킹 | **LLM 청킹** (기본값, `chunking_method=llm`) — Gemini 2.5 Flash, 배치 단위 의미 경계 분할, 노이즈 제거 포함 / `rule` 옵션으로 rule-based 전환 가능 |
| 정규화 | 특수문자 치환, 줄바꿈 결합, 짧은 청크 병합 |
| 중복 방지 | SHA-1 `content_hash` 기반 — 배치 중복 SELECT → 신규 청크만 1회 배치 INSERT |
| 벡터화 | Gemini Embedding 2 (`gemini-embedding-exp-03-07`) — **1536차원** 벡터 변환 |
| 저장 | `doc_chunks` (content, metadata JSONB, embedding vector(1536)) — `hierarchy_h1/h2/h3` metadata에 포함 |

#### STEP 2 — 계층 태깅 (2단계)

| 단계 | API | 동작 |
|------|-----|------|
| 단계 1 — H1/H2/H3 Master + domain_profile 생성 | `analyze-hierarchy` | anchor 청크 30개 → LLM **1회** → **H1(3~5개) + H2/H3 전체 master + domain_profile 동시 생성** → `doc_metadata` 저장 |
| 단계 2 — 청크 태깅 | `apply-granular-tagging` | 청크별 계층 목록에서 **선택만** (신규 생성 금지) — 일괄 적용, `__admin__` 제외 샘플 5개 반환 |

> 단계 1에서 `domain_profile`(domain, domain_short, target_audience, key_terms, tone)을 `doc_metadata` 테이블에 함께 저장 → QA 생성 시 LLM 재호출 없이 캐시 사용
>
> 단계 2 완료 후 `doc_chunks.metadata.hierarchy_h1/h2/h3` 업데이트 → 프론트엔드 H1/H2 드롭다운으로 생성 범위 지정

#### STEP 3 — QA 생성

| 단계 | 내용 |
|------|------|
| 계층 기반 청크 선별 | H1/H2 필터 조회, heading·colophon·`__admin__` 청크 제외 |
| 도메인 프로파일 | `doc_metadata` 캐시 우선 조회 (LLM 0회) — 없을 경우에만 `domain_profiler.analyze_domain()` 폴백 |
| 프롬프트 빌드 | `build_user_template` — domain_profile 기반 XML 태그 적응형 구성 |
| 다중 모델 동시 생성 | `ThreadPoolExecutor` — 모델별 worker 수 분리 병렬 실행 |

**생성 규칙**

| 규칙 | 내용 |
|------|------|
| 수량 | 4~8개 유연 조정 (컨텍스트 적합성 기반) |
| 의도 유형 선택 | 근거 있는 유형만, 동일 유형 최대 2회 |
| 다양성 | 우선 그룹(factoid / definition / how) ≤ 50% |
| procedure | 문서에 순서 있는 단계(1→2→3) 명시 시에만 선택 |
| 질문 근거 | 컨텍스트에 명시된 사실/정의/절차에만 한정, 유추 금지 |
| 답변 스타일 | 메타 표현 시작 금지 ("컨텍스트에 따르면" 등) |

#### STEP 4 — QA 평가

| 레이어 | 모듈 | 평가 항목 | 가중치 |
|--------|------|----------|--------|
| Layer 1-A Syntax | `syntax_validator.py` | 필드 존재·타입·길이 검사 | 5% |
| Layer 1-B Statistics | `dataset_stats.py` | 다양성·중복률 통계 | 5% |
| Layer 2 RAG Triad | `rag_triad.py` | 관련성 · 근거성 · 맥락성 | 65% |
| Layer 3 Quality | `qa_quality.py` | 완전성(completeness) | 25% |

```
final_score = syntax×0.05 + stats×0.05 + rag×0.65 + quality×0.25

A+ (≥0.95) / A (≥0.85) / B+ (≥0.75) / B (≥0.65) / C (≥0.50) / F (<0.50)
```

#### STEP 5 — 결과 확인

| 기능 | 내용 |
|------|------|
| 평가 결과 확인 | QA 상세 · 차원별 평가 근거 · 실패 유형 뱃지 연동 |
| 리포트 내보내기 | 평가 이력 관리 · 버튼 크기 통일(w-36) · XLSX / HTML / ZIP 다운로드 |
| 대시보드 | 파이프라인 로그 연동 · 평가 등급 분포 · **모델별 성능 비교 리더보드 (합격률/점수)** |
| 히스토리 연동 | 대시보드 파이프라인 로그 클릭 → 평가 탭 자동 이동 + 해당 이력 다크모드 하이라이트 |

---

## 아키텍처

```
autoeval/
├── backend/
│   ├── Dockerfile                   # Python 3.12-slim + uv, TZ=Asia/Seoul, curl 포함
│   ├── main.py                      # FastAPI 앱 + 라우트 등록 + 로깅 설정
│   │                                  GET /api/dashboard/metrics 포함
│   ├── api/
│   │   ├── ingestion_api.py         # POST /api/ingestion/* — 라우터 + process_and_ingest
│   │   ├── generation_api.py        # POST /api/generate — 병렬 QA 생성 job
│   │   └── evaluation_api.py        # POST /api/evaluate — 4레이어 평가 job
│   ├── ingestion/
│   │   ├── parsers.py               # 파싱·정규화·필터·청킹 순수 함수 (I/O 없음)
│   │   └── llm_chunker.py           # LLM 청킹 모듈 — Gemini 2.5 Flash, 배치·병렬 처리 (기본 청킹)
│   ├── generators/
│   │   ├── qa_generator.py          # 프로바이더별 LLM API 호출 + 응답 파싱
│   │   └── domain_profiler.py       # 폴백 전용 — doc_metadata 없을 때만 LLM 호출
│   ├── evaluators/
│   │   ├── pipeline.py              # 4레이어 순서 실행 + Supabase 저장
│   │   ├── syntax_validator.py      # Layer 1-A: 구문 검증
│   │   ├── dataset_stats.py         # Layer 1-B: 다양성·중복률 통계
│   │   ├── rag_triad.py             # Layer 2: RAG Triad (XML 프롬프트)
│   │   ├── qa_quality.py            # Layer 3: Quality Score (XML, system/user 분리)
│   │   ├── recommendations.py       # 평가 결과 기반 개선 권고 생성
│   │   └── job_manager.py           # in-memory 평가 job 관리
│   ├── db/                          # Supabase Repository 패키지
│   │   ├── base_client.py           # 클라이언트 초기화, require_client(), health_check()
│   │   ├── qa_generation_repo.py    # QA 생성 결과 저장/조회
│   │   ├── evaluation_repo.py       # 평가 결과 저장/조회
│   │   ├── generation_eval_link.py  # 생성-평가 연결 (linked_evaluation_id)
│   │   ├── doc_chunk_repo.py        # 문서 청크 CRUD + vector 검색
│   │   ├── doc_metadata_repo.py     # domain_profile + h2_h3_master upsert/get (doc_metadata 테이블)
│   │   ├── hierarchy_repo.py        # 계층 목록 조회 / 일괄 업데이트
│   │   └── dashboard_repo.py        # 대시보드 집계 (summary, recent_jobs, grade_dist)
│   └── config/
│       ├── prompts.py               # XML 태그 프롬프트 + 적응형 빌더 (build_user_template)
│       ├── supabase_client.py       # re-export wrapper → backend/db/ 위임 (하위 호환)
│       ├── models.py                # 모델 alias → model_id, cost 매핑
│       └── constants.py             # worker 수 등 기본 상수
│
├── frontend/
│   ├── Dockerfile                   # Node 빌드 → nginx:alpine (프로덕션)
│   ├── Dockerfile.dev               # Node 20-alpine Vite dev server (HMR)
│   ├── nginx.conf                   # SPA 라우팅 + /api/ 리버스 프록시 (resolver 127.0.0.11)
│   └── src/
│       ├── App.tsx                  # 탭 라우팅 + Glassmorphism 배경 (gradient mesh)
│       ├── lib/api.ts               # 백엔드 API 클라이언트 함수
│       └── components/
│           ├── layout/
│           │   ├── Sidebar.tsx          # 글래스 사이드바 (bg-slate-900/95 backdrop-blur-xl)
│           │   └── Header.tsx           # 글래스 헤더 (bg-white/70 backdrop-blur-md)
│           ├── dashboard/
│           │   ├── DashboardOverview.tsx  # 실시간 대시보드 (Supabase 집계 데이터)
│           │   ├── StatsCards.tsx         # 통계 카드 (accent border + glass)
│           │   └── ActivityChart.tsx      # 점수 추이 차트
│           ├── standardization/
│           │   └── DataStandardizationPanel.tsx  # 업로드 + 3-Pass 태깅 UI
│           ├── generation/
│           │   └── QAGenerationPanel.tsx         # H1/H2 드롭다운 + 생성 설정 UI
│           ├── evaluation/
│           │   └── QAEvaluationDashboard.tsx     # 평가 결과 + 레이어별 점수 UI
│           ├── playground/
│           │   └── ChatPlayground.tsx            # LLM 채팅 플레이그라운드
│           └── settings/
│               ├── SettingsPanel.tsx             # 시스템 설정 (Profile / API Keys / Pipeline)
│               └── PipelineFlow.tsx              # ReactFlow 5-스텝 파이프라인 시각화
│
├── docker-compose.yml               # 프로덕션: server(8000) + client(3000), healthcheck
├── docker-compose.dev.yml           # 개발 오버라이드: 소스 볼륨 마운트 + Vite HMR
├── .env.example                     # 환경 변수 템플릿 (ANTHROPIC / GOOGLE / OPENAI / SUPABASE)
└── README.md
```

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| **Frontend** | React 19, TypeScript, Tailwind CSS, Vite, Lucide icons |
| **UI Style** | Glassmorphism Light — gradient mesh 배경, backdrop-blur, accent border |
| **Backend** | FastAPI (Python 3.12+), Uvicorn, uv |
| **Database** | Supabase (PostgreSQL 15 + pgvector), service_role key |
| **Embeddings** | Gemini Embedding 2 (`gemini-embedding-exp-03-07`) — 1536dim, HNSW 인덱스 |
| **Prompt 구조** | XML 태그 (`<role>` `<principles>` `<intent_types>` `<constraints>` `<context>` `<task>`) |
| **병렬 처리** | `ThreadPoolExecutor` — 모델별 worker 수 분리 |

---

## 모델 구성

### 파이프라인 전용 모델

| 용도 | 모델 | 비고 |
|------|------|------|
| LLM 청킹 | Gemini 2.5 Flash (`gemini-2.5-flash`) | 배치 단위, thinking OFF (`thinking_budget=0`) |
| Embedding | Gemini Embedding 2 (`gemini-embedding-exp-03-07`) | 1536차원, RPM 3,000 |
| Hierarchy + domain_profile 분석 | Gemini 3 Flash (`gemini-3-flash-preview`) | anchor 30청크 → 1회 호출 |
| 계층 태깅 (Pass 3) | Gemini 2.5 Flash (`gemini-2.5-flash`) | 청크별 배치 분류 — 선택 task, 2.5 Flash로 충분 |

### QA 생성 모델

| 모델 | RPM | TPM | Workers |
|------|-----|-----|---------|
| GPT-5.2 (`gpt-5.2-2025-12-11`) | 500 | 500K | 5 |
| Gemini 3 Flash (`gemini-3-flash-preview`) | 1,000 | 2M | 5 |
| Claude Sonnet 4.6 (`claude-sonnet-4-6`) | 50 | 30K | 2 |

### 평가 모델

| 모델 | RPM | TPM | Workers |
|------|-----|-----|---------|
| GPT-5.1 (`gpt-5.1-2025-11-13`) | 500 | 500K | 8 |
| Gemini 2.5 Flash (`gemini-2.5-flash`) | 1,000 | 1M | 10 |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | 50 | 50K | 2 |

---

## DB 스키마

Supabase (autoeval 프로젝트) — 4개 테이블

| 객체 | 유형 | 설명 |
|------|------|------|
| `doc_chunks` | 테이블 | 문서 청크 + vector(1536) + metadata JSONB |
| `doc_metadata` | 테이블 | 문서별 domain_profile + h2_h3_master (UNIQUE document_id, Option A 논리적 연결) |
| `qa_gen_results` | 테이블 | QA 생성 결과 (qa_list JSONB, doc_chunk_ids uuid[]) |
| `qa_eval_results` | 테이블 | 4레이어 평가 결과 + final_score + final_grade |

### 테이블 연계

```
doc_chunks.metadata->>'document_id'
  ↔ doc_metadata.document_id   (논리적 연결, FK 없음 — Option A)

doc_chunks.id
  ← qa_gen_results.doc_chunk_ids[]   (GIN 인덱스)
  ← qa_gen_results.qa_list[*].docId  (JSONB 내부)

qa_gen_results.id
  ← qa_eval_results.metadata.generation_id

qa_gen_results.linked_evaluation_id
  → qa_eval_results.id
```

> `doc_metadata` FK 연결(Option B)은 파이프라인 안정화 후 DB 전면 재설계 시 적용 예정 (`docs/REF_DB.md` 참고)

### 최종 등급 체계

```
final_score = syntax×0.05 + stats×0.05 + rag×0.65 + quality×0.25

A+ (≥0.95) / A (≥0.85) / B+ (≥0.75) / B (≥0.65) / C (≥0.50) / F (<0.50)
```

---

## 빠른 시작

### 로컬 개발 (권장)

#### 1. 의존성 설치

```bash
# Python (uv 권장, 프로젝트 루트에서 실행)
uv sync

# Node
cd frontend && npm install
```

#### 2. 환경 변수

```bash
# 프로젝트 루트에 .env 파일 생성 (.env.example 참고)
cp .env.example .env
```

```env
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
OPENAI_API_KEY=...
SUPABASE_URL=...
SUPABASE_API_KEY=...   # service_role 키
LOG_LEVEL=INFO
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

#### 3. DB 초기화 (최초 1회)

Supabase SQL Editor에서 순서대로 실행:

```
backend/scripts/setup_vector_db.sql       # doc_chunks + match_doc_chunks RPC
backend/scripts/setup_qa_eval_tables.sql  # qa_eval_results, qa_gen_results
-- + get_eval_qa_scores RPC (pipeline_results에서 qa_scores만 추출)
```

#### 4. 서버 실행

```bash
# Backend (프로젝트 루트에서)
python -m uvicorn backend.main:app --reload
# → http://localhost:8000  |  Swagger: http://localhost:8000/docs

# Frontend (별도 터미널)
cd frontend && npm run dev
# → http://localhost:3000
```

---

### Docker (로컬 환경 통일)

```bash
# 1. 환경변수 준비
cp .env.example .env   # API 키 입력

# 2. 이미지 빌드
docker compose build

# 3. 백그라운드 실행
docker compose up -d

# 4. 로그 확인
docker compose logs -f

# 5. 중지
docker compose down
```

```bash
# 개발 모드 (server --reload + client Vite HMR)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

```bash
# 유용한 명령어
docker compose ps                    # 컨테이너 상태 확인
docker compose logs server --tail=50 # server 로그
docker compose logs client --tail=20 # client(nginx) 로그
docker compose restart server        # server만 재시작
docker compose build client          # client 이미지만 재빌드
```

```bash
# 코드 변경 후 반영 방법
# ⚠️  docker compose up -d 만으로는 변경사항이 반영되지 않음 (기존 이미지 재사용)

# Python(백엔드) 변경 시
docker compose restart server

# React/TSX(프론트엔드) 변경 시 — nginx가 컴파일된 정적 파일을 서빙하므로 재빌드 필요
docker compose build client && docker compose up -d client

# 백엔드 + 프론트엔드 모두 변경 시
docker compose up -d --build
```

| 서비스 | 포트 | 설명 |
|--------|------|------|
| client | 3000 | Nginx → SPA + `/api/` 프록시 → server |
| server | 8000 | FastAPI (직접 접근 가능, Swagger `/docs`) |

> **참고**: nginx upstream DNS 지연 문제로 `resolver 127.0.0.11`(Docker 내장 DNS) + `set $upstream` 변수 사용 → 요청 시점 동적 조회

---

## API 엔드포인트

### Ingestion

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/ingestion/upload` | PDF/DOCX 업로드 → LLM/rule 청킹 → 임베딩 → doc_chunks 저장 |
| `POST` | `/api/ingestion/analyze-hierarchy` | anchor 30개 → H1/H2/H3 master + domain_profile 동시 생성 → doc_metadata 저장 |
| `POST` | `/api/ingestion/analyze-tagging-samples` | 이미 태깅된 청크 샘플 조회 (`__admin__` 제외, H1 다양성 우선 5개) |
| `POST` | `/api/ingestion/apply-granular-tagging` | Pass 3 — 청크별 hierarchy 일괄 적용 (`__admin__` 제외 샘플 5개 반환) |
| `GET`  | `/api/ingestion/hierarchy-list` | H1/H2/H3 고유 목록 (드롭다운용) |

### Generation

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/generate` | QA 생성 job 시작 |
| `GET`  | `/api/generate/{job_id}/status` | 생성 job 상태 조회 |
| `GET`  | `/api/generate/{job_id}/preview` | 생성 완료 후 QA 미리보기 (최대 N개, context 포함) |
| `GET`  | `/api/generate/jobs` | 세션 내 전체 job 목록 |
| `DELETE` | `/api/generate/{job_id}` | job 취소 |

### Evaluation

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/evaluate` | 4레이어 평가 job 시작 |
| `GET`  | `/api/evaluate/{job_id}/status` | 평가 job 상태 + 레이어별 결과 |
| `GET`  | `/api/evaluate/list` | 세션 내 평가 job 목록 (in-memory) |
| `GET`  | `/api/evaluate/history` | Supabase 저장된 평가 이력 전체 |
| `GET`  | `/api/evaluate/{job_id}/export` | 세션 job QA+점수 상세 내보내기 |
| `GET`  | `/api/evaluate/export-by-id/{eval_id}` | Supabase eval_id 기반 상세 내보내기 |

### System

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스체크 |
| `GET` | `/api/dashboard/metrics` | 대시보드 집계 데이터 (summary, recent_jobs, grade_dist, model_benchmarks) |

---

## 배포 구성 (Render + Vercel)

| 플랫폼 | 역할 | 환경변수 |
| ------ | ---- | -------- |
| Render | FastAPI 백엔드 | `CORS_ORIGINS=https://autoeval-v1.vercel.app` |
| Vercel | React 프론트엔드 | `VITE_API_URL=https://autoeval-uccr.onrender.com` |

- Render는 `PORT` 환경변수를 자동 주입 → `main.py`에서 `os.getenv("PORT", 8000)`으로 대응
- 로컬 개발 시 Vite 프록시가 `/api/*`를 `localhost:8000`으로 포워딩 (`vite.config.ts`)
- Vercel 배포 시 `vercel.json` rewrites가 `/api/*`를 Render로 서버사이드 포워딩 → CORS 불필요

```
브라우저 요청 흐름
  로컬  : localhost:3000/api/... → Vite 프록시 → localhost:8000
  Vercel: autoeval-v1.vercel.app/api/... → Vercel rewrites → autoeval-uccr.onrender.com
```

---

**Last Updated**: 2026-03-30 | **Branch**: main
