# OpenAI Embedding Provider 도입 기획 (2026-06-29)

> Gemini Embedding 2 quota/routing 이슈에 대비해 OpenAI embedding을 선택 가능한 대안으로 도입하는 방안 검토

---

## 1. 배경

현재 인제스션/검색 파이프라인은 Gemini Embedding 2를 사용한다.

```text
기본 모델: gemini-embedding-2
벡터 차원: 1536
저장 위치: doc_chunks.embedding vector(1536)
검색 방식: match_doc_chunks RPC + cosine similarity
```

Render에서 Gemini Embedding 2 호출이 Vertex AI quota 축으로 429를 반환한 사례가 있어, OpenAI embedding을 fallback 또는 선택 provider로 둘 수 있는지 검토한다.

---

## 2. 후보 모델

OpenAI 공식 embedding 가이드 기준 후보:

| 모델 | Pages per dollar | MTEB | Max input | 비고 |
| --- | ---: | ---: | ---: | --- |
| `text-embedding-3-small` | 62,500 | 62.3% | 8192 | 기본 1536차원, 현재 DB와 가장 잘 맞음 |
| `text-embedding-3-large` | 9,615 | 64.6% | 8192 | 기본 3072차원, `dimensions=1536` 축소 검토 필요 |
| `text-embedding-ada-002` | 12,500 | 61.0% | 8192 | 구세대 모델, 신규 도입 우선순위 낮음 |

1차 후보는 `text-embedding-3-small`.

이유:

- 기본 embedding 차원이 1536이라 `doc_chunks.embedding vector(1536)` 유지 가능
- 비용 효율이 가장 좋음
- 기존 OpenAI SDK와 `OPENAI_API_KEY`가 이미 프로젝트에 있음
- Gemini quota 문제가 발생했을 때 운영 fallback으로 쓰기 쉬움

---

## 3. 핵심 제약

### 3.1 벡터 공간 혼합 금지

Gemini embedding과 OpenAI embedding은 같은 1536차원이어도 벡터 공간이 다르다.

따라서 아래 조합은 금지한다.

```text
OpenAI query vector → Gemini document vector 검색
Gemini query vector → OpenAI document vector 검색
```

같은 provider/model로 생성된 문서 벡터와 쿼리 벡터끼리만 cosine similarity를 계산해야 한다.

### 3.2 기존 문서 재임베딩 필요

전역 provider를 OpenAI로 전환하면 기존 Gemini embedding 문서는 OpenAI 쿼리로 검색할 수 없다.

선택지:

- 기존 문서를 OpenAI로 재인제스션/재임베딩
- 문서별 `embedding_provider` / `embedding_model` 필터로 같은 모델끼리만 검색
- 별도 OpenAI embedding 컬럼 또는 테이블 운영

### 3.3 DB 차원

현재 DB와 RPC는 1536차원 기준이다.

```sql
embedding vector(1536)
```

따라서:

- `text-embedding-3-small`: 그대로 사용 가능
- `text-embedding-3-large`: `dimensions=1536`으로 축소하지 않으면 DB 스키마 변경 필요

과거 히스토리상 HNSW 고차원 제한을 피하기 위해 1536차원을 유지한 맥락이 있으므로, 3072차원 전환은 우선순위 낮음.

---

## 4. 설계 옵션

### Option A — 전역 provider 전환

환경변수로 전체 embedding provider를 하나만 선택한다.

```text
EMBED_PROVIDER=google | openai
EMBED_MODEL=gemini-embedding-2 | text-embedding-3-small
EMBED_DIMENSIONS=1536
```

장점:

- 구현이 가장 단순
- 검색 RPC 변경이 작음
- 운영 환경에서 provider 선택이 명확함

단점:

- provider 전환 시 기존 문서 재임베딩 필요
- 기존 Gemini 문서와 신규 OpenAI 문서가 섞이면 검색 품질이 깨질 수 있음

적합도:

- 단기 fallback 구현에 적합

### Option B — 문서별 provider/model 고정

`doc_chunks.metadata` 또는 전용 컬럼에 provider/model을 저장하고, 검색 시 같은 provider/model만 필터링한다.

예시 metadata:

```json
{
  "embedding_provider": "openai",
  "embedding_model": "text-embedding-3-small",
  "embedding_dimensions": 1536
}
```

장점:

- 기존 Gemini 문서와 신규 OpenAI 문서 공존 가능
- 점진적 migration 가능
- 검색 품질 보호 가능

단점:

- `match_doc_chunks` RPC 필터 또는 호출부 수정 필요
- UI/운영에서 문서별 embedding provider 상태를 인지해야 함

적합도:

- 장기 운영에 가장 안전

### Option C — 별도 컬럼/테이블

예시:

```text
doc_chunks.embedding_gemini vector(1536)
doc_chunks.embedding_openai vector(1536)
```

또는:

```text
doc_chunks
doc_chunk_embeddings
```

장점:

- 같은 청크에 여러 embedding provider를 병렬 저장 가능
- provider별 검색 벤치마크에 좋음

단점:

- DB/RPC/인덱스 복잡도 증가
- 저장 비용과 재임베딩 작업 증가

적합도:

- 벤치마크와 장기 확장에는 좋지만 지금 단계에서는 과함

---

## 5. 추천 방향

### Phase 1 — Provider abstraction + 전역 OpenAI fallback

먼저 단순하고 안전한 provider abstraction을 만든다.

구성:

```text
backend/ingestion/embeddings.py
  - embed_documents(chunks) -> list[list[float]]
  - embed_query(query) -> list[float]
  - get_embedding_config()
```

환경변수:

```text
EMBED_PROVIDER=google
EMBED_MODEL=gemini-embedding-2
EMBED_DIMENSIONS=1536
```

OpenAI fallback 예:

```text
EMBED_PROVIDER=openai
EMBED_MODEL=text-embedding-3-small
EMBED_DIMENSIONS=1536
```

주의:

- 전역 provider를 바꾼 경우 기존 문서와 섞이지 않게 운영해야 함
- `metadata.embedding_model`에 실제 모델명을 반드시 저장
- 가능하면 `metadata.embedding_provider`도 추가

### Phase 2 — 같은 provider/model 검색 필터

`retrieval_query` 검색 시 문서 벡터의 provider/model과 쿼리 embedding provider/model이 일치하도록 필터링한다.

필요 변경:

- 저장 metadata에 `embedding_provider`, `embedding_dimensions` 추가
- `search_doc_chunks` / `match_doc_chunks` 호출 filter에 embedding 조건 추가
- 기존 문서의 metadata 보정 또는 재임베딩 전략 수립

### Phase 3 — 벤치마크

동일 문서/동일 query set으로 비교한다.

비교 대상:

- `gemini-embedding-2`
- `text-embedding-3-small`
- `text-embedding-3-large` with `dimensions=1536`

측정:

- retrieval hit rate
- RAG context relevance
- QA generation pass rate
- latency
- API cost
- quota 안정성

---

## 6. 구현 영향 범위

### 백엔드

수정 후보:

```text
backend/ingestion/pipeline.py
backend/generators/worker.py
backend/db/doc_chunk_repo.py
backend/scripts/setup_vector_db.sql
docs/Guide/REF_RAG.md
docs/Guide/REF_DB.md
README.md
backend/README.md
```

현재 코드상 embedding 호출 위치:

- 문서 저장: `backend/ingestion/pipeline.py`
- retrieval query: `backend/generators/worker.py`

### DB/RPC

현 구조:

```text
doc_chunks.embedding vector(1536)
doc_chunks.metadata jsonb
match_doc_chunks(query_embedding, match_threshold, match_count, filter)
```

추가 검토:

- metadata JSONB filter로 `embedding_provider` / `embedding_model` 필터 가능 여부
- RPC 내부에서 filter JSONB 조건을 이미 어떻게 처리하는지 확인 필요

### 프론트엔드

초기 fallback만 구현하면 UI 변경은 없어도 된다.

장기적으로는 문서 메타에 embedding provider 표시를 추가할 수 있다.

---

## 7. 리스크

| 리스크 | 설명 | 대응 |
| --- | --- | --- |
| 벡터 공간 혼합 | provider/model이 다른 벡터끼리 검색하면 similarity가 무의미 | provider/model 필터 강제 |
| 기존 문서 검색 품질 저하 | 전역 provider 전환 후 기존 Gemini 문서를 OpenAI 쿼리로 검색 | 재임베딩 또는 provider별 검색 |
| 비용 추정 누락 | embedding 비용이 현재 생성 비용 추정과 별도로 관리됨 | 추후 embedding 비용 로깅 추가 |
| quota 회피 착각 | OpenAI도 rate limit이 있음 | provider별 retry/backoff와 에러 메시지 분리 |
| 운영 혼선 | env만 바꾸면 신규 문서만 다른 provider로 저장될 수 있음 | 배포 체크리스트와 metadata 표시 추가 |

---

## 8. 미결정 사항

- OpenAI fallback을 자동으로 할지, 환경변수 전환으로만 할지
- 기존 Gemini 문서의 재임베딩 범위
- `embedding_provider`를 metadata에만 둘지 전용 컬럼으로 둘지
- `text-embedding-3-large dimensions=1536` 벤치마크를 포함할지
- embedding API 비용을 job stats에 포함할지

---

## 9. 테스트 스크립트

추가 파일:

```text
backend/scripts/compare_embedding_providers.py
```

기능:

- Gemini / OpenAI embedding provider 비교
- 기본 내장 케이스 5개 사용
- 각 케이스는 `query`, `positive`, `negative`로 구성
- positive similarity가 negative보다 높은지 hit rate 계산
- API key 원문은 출력하지 않고 `key_id`만 출력

실행:

```bash
python backend/scripts/compare_embedding_providers.py
python backend/scripts/compare_embedding_providers.py --provider google
python backend/scripts/compare_embedding_providers.py --provider openai
python backend/scripts/compare_embedding_providers.py --cases-file path/to/cases.json
```

로컬 venv 사용 시:

```bash
.venv/bin/python backend/scripts/compare_embedding_providers.py
```

초기 실행 결과:

| Provider | Model | Requests | Latency | Hit rate |
| --- | --- | ---: | ---: | ---: |
| Google | `gemini-embedding-2` | 15 | 6775.9ms | 100% |
| OpenAI | `text-embedding-3-small` | 1 | 4305.8ms | 100% |

관찰:

- 두 모델 모두 5개 sanity case에서 positive 문서를 negative 문서보다 높게 평가
- OpenAI는 list input batch 1회로 처리되어 같은 테스트에서 latency가 낮았음
- OpenAI `text-embedding-3-small`은 margin이 전반적으로 더 크게 나왔지만, 샘플 수가 작아 품질 결론으로 단정하면 안 됨
- 실제 문서 청크와 실제 retrieval query set으로 Phase 3 벤치마크 필요

DB 청크 샘플 실행:

```bash
.venv/bin/python backend/scripts/compare_embedding_providers.py \
  --db-cases 10 \
  --db-pool-limit 500 \
  --db-min-chars 160 \
  --max-doc-chars 2200
```

주의:

- 이 모드는 Supabase `doc_chunks.content` 샘플을 Gemini/OpenAI embedding API로 전송한다
- 실행 전 민감 문서 포함 여부를 검토하고 명시 승인 후 실행해야 한다
- 출력에는 API key 원문과 청크 본문을 표시하지 않는다

DB 샘플 결과:

| Provider | Model | Requests | Latency | Hit rate | Avg margin |
| --- | --- | ---: | ---: | ---: | ---: |
| Google | `gemini-embedding-2` | 30 | 13422.8ms | 100% | 0.221 |
| OpenAI | `text-embedding-3-small` | 1 | 3702.4ms | 100% | 0.283 |

관찰:

- 실제 DB 청크 10개 sanity case에서도 두 모델 모두 positive 청크를 negative 청크보다 높게 평가
- OpenAI는 한 번의 batch 호출로 처리되어 latency가 낮았음
- OpenAI 평균 margin이 더 컸지만, negative 샘플링 방식이 단순하므로 최종 품질 판단에는 실제 query/relevance 라벨셋이 필요
- Gemini는 현재 `gemini-embedding-2` API 특성상 청크별 호출로 비교되어 request 수가 많음

---

## 10. 결론

단기적으로는 `gemini-embedding-2`를 기본 유지하고, `text-embedding-3-small`을 전역 fallback provider로 추가하는 설계가 가장 현실적이다.

장기적으로는 문서별 `embedding_provider` / `embedding_model` 필터를 도입해 provider 혼합으로 인한 검색 품질 붕괴를 방지해야 한다.
