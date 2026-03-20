# Backend Flow

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

### POST `/upload` — PDF 수집

```
1. PDF/DOCX 파일 수신
2. PyMuPDF (PDF) 또는 python-docx (DOCX) 텍스트 추출
3. 최소 길이 검증 (PDF: 300자, DOCX: 100자)
4. Background: process_and_ingest()
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
   │   ├── chunk_type 분류
   │   └── context prefix 구성
   ├── Gemini Embedding 2 배치 임베딩 (3072 dims, L2 정규화)
   └── Supabase doc_chunks 저장
```

### POST `/analyze-hierarchy` — H1 분석 (Pass 1)

```
1. doc_chunks 샘플 조회 (limit 15)
2. 컨텐츠 연결 (최대 15k자)
3. Gemini 3.1 Flash 호출 → JSON 스키마:
   {
     "domain_analysis": "1문장 요약",
     "h1_candidates": ["분류1", "분류2", "분류3"],
     "suggested_hierarchy": { "h1": "...", "h2": "...", "h3": "..." },
     "validation": "분류 근거"
   }
4. H1 후보 반환 (3~5개)
```

### POST `/analyze-h2-h3` — H2/H3 분석 (Pass 2)

```
1. doc_chunks 샘플 조회 (limit 30)
2. 선택된 H1 목록과 함께 Gemini 호출
3. H2/H3 계층 생성:
   {
     "H1명": {
       "H2명A": ["H3_1", "H3_2"],
       "H2명B": ["H3_1", "H3_2"]
     }
   }
4. 중첩 계층 마스터 반환
```

### POST `/apply-granular-tagging` — 계층 태깅 (Pass 3)

```
1. 전체 청크 조회 (limit 2000)
2. 5개씩 배치, 동시성 5 처리
3. 배치별 Gemini 호출:
   - master_hierarchy + 청크 내용 (최대 1000자)
4. 응답 파싱: [{idx, hierarchy: {h1, h2, h3}}, ...]
5. Supabase metadata 업데이트:
   - hierarchy_h1, hierarchy_h2, hierarchy_h3
```

### GET `/hierarchy-list` — 계층 목록

```
1. doc_chunks metadata에서 고유 H1/H2/H3 조회
2. 반환:
   {
     "h1_list": [...],
     "h2_by_h1": {"H1명": ["H2a", "H2b"]},
     "h3_by_h1_h2": {"H1명::H2a": ["H3_1", ...]}
   }
```

---

## Generation API (`/api/generation`)

### POST `/generate` — QA 생성

```
1. job_id 생성: gen_YYYYMMDD_HHMMSS_μs
2. 즉시 job_id 반환 (비동기)
3. Background: run_qa_generation()
   ├── [진행 5%] 청크 조회 (H1/H2/H3 필터 또는 벡터 검색)
   │   └── 벡터 검색 시: Gemini로 쿼리 임베딩 → match_doc_chunks() RPC
   ├── [진행 10%] 도메인 프로파일링 (job당 1회, 캐시)
   │   └── LLM → {domain, target_audience, key_terms, intent_hints, ...}
   ├── 적응형 프롬프트 구성 (domain_profile 기반)
   ├── [진행 10~90%] 병렬 QA 생성 (ThreadPoolExecutor)
   │   ├── 모델별 워커 수:
   │   │   ├── Claude Sonnet: 2 workers
   │   │   ├── Gemini Flash: 5 workers
   │   │   └── GPT-5.x: 5 workers
   │   ├── per item: generate_qa() → JSON 파싱 → qa_list 추출
   │   └── Fatal 에러 시 즉시 중단 (429/401)
   ├── [진행 92%] Supabase qa_gen_results 저장
   └── [진행 100%] 완료
```

### GET `/{job_id}/status`
```
인메모리 job 상태 반환: status, progress, message, error, result_id
```

### GET `/{job_id}/preview`
```
1. result_id로 Supabase qa_gen_results 조회
2. qa_list 평탄화 (최대 limit개)
3. 반환: context 스니펫 + q + a + intent
```

---

## Evaluation API (`/api/evaluation`)

### POST `/evaluate` — QA 평가

```
1. job_id 생성: eval_YYYYMMDD_HHMMSS_μs
2. 즉시 job_id 반환 (비동기)
3. Background: run_evaluation()
   ├── Supabase에서 QA 결과 로드
   ├── 중첩 qa_list 평탄화 → [{q, a, context, intent, docId}]
   └── run_full_evaluation_pipeline():
       ├── [Layer 1-A] Syntax Validation (병렬, workers=4)
       │   └── 필드/타입/길이 검증 → pass_rate
       ├── [Layer 1-B] Dataset Statistics (순차)
       │   └── 다양성/중복/편향/충분성 → integrated_score (0~10)
       ├── [Layer 2] RAG Triad (병렬)
       │   └── LLM × 3차원 → relevance/groundedness/clarity
       ├── [Layer 3] Quality Evaluation (병렬)
       │   └── LLM × 4차원 → factuality/completeness/specificity/conciseness
       ├── final_score 계산 (가중 합산)
       ├── final_grade 결정
       ├── LLM 개선 권고 생성
       └── Supabase qa_eval_results 저장
```

### GET `/history`
```
1. Supabase qa_eval_results 조회 (limit 50, 최신순)
2. linked_evaluation_id로 source_doc 역추적
3. 히스토리 목록 반환
```

### GET `/{job_id}/export` / `/export-by-id/{eval_id}`
```
1. qa_gen_results + pipeline_results 조인
2. QA쌍별 점수(rag_avg, quality_avg, pass) 결합
3. 상세 export 배열 반환
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

| 프로바이더 | 생성 | 평가 |
|-----------|------|------|
| Anthropic (Claude) | 2 | 2 |
| Google (Gemini) | 5 | 10 |
| OpenAI (GPT) | 5 | 8 |
