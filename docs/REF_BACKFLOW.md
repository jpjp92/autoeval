# Backend Flow

> 마지막 업데이트: 2026-04-06

## 진입점

```
backend/main.py
├── FastAPI 앱 생성
├── CORS 설정 (CORS_ORIGINS 환경변수)
├── 라우터 등록: ingestion / generation / evaluation
├── /health 엔드포인트
└── uvicorn.run (PORT 환경변수, 기본 8000)
```

---

## Ingestion API (`/api/ingestion`)

### POST `/upload` — PDF/DOCX 수집

```
1. PDF/DOCX 파일 수신
2. PyMuPDF (PDF) 또는 python-docx (DOCX) 텍스트 추출
3. 최소 길이 검증 (PDF: 300자, DOCX: 100자)
4. doc_metadata row 선점 upsert (FK 충족 — document_id + filename)
5. Background: process_and_ingest()
   ├── 블록 파싱 → 반복 헤더 제거
   ├── 짧은 블록 병합
   ├── 섹션 계층 구성 (Section-First 청킹)
   ├── 섹션별 청크 분할 (200~1200자)
   ├── 필터링:
   │   ├── TOC 감지 → 제거
   │   ├── 콜로폰/메타 → 제거
   │   ├── 심볼 노이즈 → 제거
   │   ├── 너무 짧음 (< 50자) → 제거
   │   └── SHA-1 중복 → 제거
   ├── 청크별 처리:
   │   ├── 키워드 추출 (spaCy)
   │   ├── chunk_type 분류 (body / heading / table / list / colophon)
   │   └── context prefix 구성
   ├── Gemini Embedding 2 배치 임베딩
   │   └── output_dimensionality=1536, L2 정규화
   └── Supabase doc_chunks 저장 (document_id 컬럼 포함)
```

### POST `/analyze-hierarchy` — Pass1+2 통합 (H1/H2/H3 master + domain_profile)

```
1. doc_chunks에서 anchor 청크 30개 균등 샘플링 (sample_doc_chunks RPC)
2. content[:600] 연결 (최대 18,000자)
3. Gemini 3.1 Flash 단일 호출:
   {
     "domain_profile": { domain, domain_short, target_audience, key_terms, tone },
     "h2_h3_master":   { "H1명": { "H2명": ["H3", ...] } }
   }
   → H1 후보는 h2_h3_master.keys()에서 서버 도출
4. doc_metadata에 domain_profile + h2_h3_master upsert
   (ON CONFLICT document_id DO UPDATE)
```

> Pass1(H1분류)과 Pass2(H2/H3 생성)를 단일 LLM 호출로 통합.
> 이후 QA 생성 시 doc_metadata 캐시 사용 — LLM 재호출 없음.

### POST `/apply-granular-tagging` — Pass3 태깅

```
1. 전체 청크 조회 (limit 2000)
2. 5개씩 배치, 동시성 5 처리
3. 배치별 Gemini 호출:
   - master_hierarchy(h2_h3_master) + 청크 내용 (content[:800])
   - 응답: [{ "idx": i, "hierarchy": { "h1", "h2", "h3" } }]
4. Supabase metadata 업데이트 (hierarchy_h1, hierarchy_h2, hierarchy_h3)
5. 실패 시 최대 2회 재시도 (0.5s → 1.0s backoff)

※ h2_h3_master 없을 때 fallback:
   - H1 목록만 제공 → H2/H3는 모델이 자유 생성 (15자 이하 한국어)
```

### GET `/hierarchy-list` — 계층 목록 (드롭다운용)

```
1. doc_chunks metadata에서 H1/H2/H3 고유값 집계
2. filter_for_qa=True (기본): 청크 수 < MIN_CHUNKS_FOR_QA(1) AND 총자수 < MIN_CONTENT_CHARS(300) 일 때 h3 제외
   → 두 조건 모두 미달인 경우에만 제외 (AND 조건 — OR 아님)
3. 최신 document_id만 사용 (재인제스션 시 구버전 H1 누적 방지)
4. 반환:
   {
     "h1_list": [...],
     "h2_by_h1": { "H1명": ["H2a", "H2b"] },
     "h3_by_h1_h2": { "H1명__H2a": ["H3_1", ...] }
   }
```

---

## Generation API (`/api/generation`)

### POST `/api/generation/generate` — QA 생성

```
1. job_id 생성: gen_YYYYMMDD_HHMMSS_μs
2. 즉시 job_id 반환 (비동기)
3. Background: run_qa_generation() → run_qa_generation_real()

   [5%] 청크 조회 (H1/H2/H3 필터 또는 벡터 검색)
        └─ 벡터 검색: Gemini Embedding → match_doc_chunks() RPC

   [10%] 도메인 프로파일 로드
        └─ doc_metadata.domain_profile 캐시 우선
        └─ 없을 때 domain_profiler.py LLM 호출 (폴백)

   [10%] 적응형 프롬프트 구성 (주 경로)
        ├─ build_system_prompt(domain_profile) → system_prompt
        └─ build_user_template(domain_profile, chunk_type, total_chunks) → user_template
            └─ 청크 수별 QA 상한:
               ≤3: max=2/min=1 / 4~7: max=3/min=2 / ≥8: max=5/min=2

   [10~90%] 병렬 QA 생성 (ThreadPoolExecutor)
        ├─ 모델별 worker 수:
        │   ├─ Claude Sonnet (Anthropic): 2 workers
        │   ├─ Gemini Flash (Google):     5 workers
        │   └─ GPT-5.x (OpenAI):         5 workers
        ├─ per item: generate_qa(system_prompt, user_template) → JSON 파싱 → qa_list 추출
        ├─ 429 에러 시 provider fallback 모델로 전환
        └─ 401 에러 시 즉시 중단

   [92%] _dedup_across_chunks(sim_threshold=0.75)
        └─ 청크 간 near-duplicate QA 제거 (SequenceMatcher 표면 유사도)
        └─ 제거된 건수 로그 기록

   [95%] Supabase qa_gen_results 저장
   [100%] 완료
```

**429 Quota Fallback 매핑**

| 원래 모델 | Fallback |
|-----------|----------|
| Anthropic (Claude) | gemini-flash |
| Google (Gemini) | gpt-5.2 |
| OpenAI (GPT) | gemini-flash |

### GET `/api/generation/{job_id}/status`
```
인메모리 job 상태 반환: status, progress, message, error, result_id
```

### GET `/api/generation/{job_id}/preview`
```
1. result_id로 Supabase qa_gen_results 조회
2. qa_list 평탄화 (최대 limit개)
3. 반환: context 스니펫 + q + a + intent
```

---

## Evaluation API (`/api/evaluation`)

### POST `/api/evaluation/evaluate` — QA 평가

```
1. job_id 생성: eval_YYYYMMDD_HHMMSS_μs
2. 즉시 job_id 반환 (비동기)
3. Background: run_evaluation()
   ├── Supabase에서 QA 결과 로드
   ├── 중첩 qa_list 평탄화 → [{q, a, context, intent, docId}]
   └── run_full_evaluation_pipeline():

       [Layer 1-A] Syntax Validation (병렬, workers=4)
           └── 필드/타입/길이 검증 → pass_rate (0–1)

       [Layer 1-B] Dataset Statistics (순차)
           └── 다양성/중복/편향/충분성 → integrated_score (0–10)
               ※ near_dup: SequenceMatcher ratio ≥ 0.75

       [Layer 2] RAG Triad (병렬)
           └── LLM 단일 호출로 3차원 동시 평가:
               relevance / groundedness / context_relevance
               rag_avg = relevance×0.3 + groundedness×0.5 + context_relevance×0.2

       [Layer 3] Quality Evaluation (병렬)
           └── LLM 단일 호출 → completeness 단일 지표
               (구 4차원 Factuality/Completeness/Specificity/Conciseness 대체)

       final_score = syntax×0.05 + stats×0.05 + rag_avg×0.65 + completeness×0.25
       final_grade → A+ / A / B+ / B / C / F

       Supabase qa_eval_results 저장 (generation_id 역방향 FK 포함)
```

### GET `/api/evaluation/{job_id}/status`
```
인메모리 job 상태 반환: status, progress, message, error
```

### GET `/api/evaluation/history`
```
1. Supabase qa_eval_results 조회 (limit 50, 최신순)
2. linked_evaluation_id로 source_doc 역추적
3. 히스토리 목록 반환
```

### GET `/api/evaluation/{job_id}/export` / `/export-by-id/{eval_id}`
```
1. qa_gen_results + pipeline_results 조인
2. QA쌍별 점수(rag_avg, quality_avg, pass) 결합
3. 상세 export 배열 반환 (get_eval_qa_scores RPC 사용)
```

---

## 공통

### GET `/health`
```json
{ "status": "healthy", "timestamp": "ISO" }
```

### GET `/api/dashboard/metrics`
```
Supabase 집계: total_qa, avg_score, doc_count, pass_rate 등
```

---

## 모델별 워커 수

| 프로바이더 | 생성 workers | 비고 |
|-----------|:------------:|------|
| Anthropic (Claude) | 2 | RPM 50 제한 |
| Google (Gemini) | 5 | RPM 1,000 |
| OpenAI (GPT) | 5 | RPM 500 |

> 평가 워커는 `rag_triad.py` / `qa_quality.py` 내부 설정 참고.
