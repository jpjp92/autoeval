# QA 자동 평가 파이프라인 전체 계획

**작성일**: 2026-03-06
**최종 목표**: KT.com 1,106개 문서 기반 QA 데이터셋 자동 생성 + RAGAS 평가 파이프라인 구축

---

## 전체 파이프라인 개요

```
[1단계] 문서 인덱싱      data_2026-03-06_normalized.json
                              ↓ 청킹 + 임베딩
                         Chroma DB (./chroma_db/)

[2단계] QA 생성          4개 스크립트 (모델 × 프롬프트 언어)
                              ↓
                         output/*.json (docId, qa_list, 토큰 정보)

[2.5단계] QA 품질 검증   DeepEval + Validator LLM
                              ↓ 질문/답변 품질 점수 산출
                         저품질 QA 필터링 → validated_output/*.json

[3단계] RAGAS 평가       검증된 QA JSON + Chroma retriever
                              ↓ retrieved_contexts 구성
                         RAGAS 점수 산출 (faithfulness, context_precision, context_recall)

[4단계] 결과 분석        스크립트별 점수 비교 → 최적 모델/프롬프트 선정
```

---

## 1단계: 문서 인덱싱 (`build_index.py`)

### 목적

Chroma로컬 DB에 1,106개 문서를 1회 인덱싱하여 재사용.

### 구현 계획

```python
# 패키지: chromadb, langchain-chroma, langchain-google-genai
# 임베딩: models/text-embedding-004 (Google, 무료)

from langchain_chroma import Chroma
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_core.documents import Document

# 1. JSON 로드 → LangChain Document 변환
docs = [
    Document(
        page_content=item["text"],
        metadata={"docId": item["docId"], "hierarchy": " > ".join(item["hierarchy"])}
    )
    for item in data if item.get("text")
]

# 2. 임베딩 + Chroma 저장 (최초 1회)
embeddings = GoogleGenerativeAIEmbeddings(model="models/text-embedding-004")
vectorstore = Chroma.from_documents(docs, embeddings, persist_directory="./chroma_db")
```

### 추가 설치 필요

```bash
uv add chromadb langchain-chroma langchain-google-genai
```

---

## 2단계: QA 생성 스크립트 현황

**최적화된 구성 (2모델 × 영어 프롬프트)**

| 파일                      | 모델                    | 프롬프트 | 비용 (1,106 QA) | 품질 | 출력                          |
| ------------------------- | ----------------------- | -------- | --------------- | ---- | ----------------------------- |
| `test_gen_flashlite_en.py` | Gemini 3.1 Flash-Lite | 영어     | **~$1.19**      | 4.92 | `output/flashlite_en_*.json` |
| `test_gen_gpt51_en.py`    | GPT-5.1                 | 영어     | **~$8.17**      | 4.94 | `output/gpt51_en_*.json`     |

**선택 근거:**
- 품질 차이 0.02점으로 거의 동일 (Flash-Lite: 4.92, GPT-5.1: 4.94)
- **비용 6.9배 절감** (Flash-Lite EN 선택 시)
- 영어 프롬프트가 한국어 대비 일관되게 저가 + 동등 이상 성능
- 기존 4-모델 구성 ($15~18) → 2-모델 구성 ($9.36)

### QA JSON 구조

```json
{
  "generated_at": "20260306_155243",
  "model": "claude-sonnet-4-5",
  "prompt_lang": "ko",
  "sample_count": 4,
  "results": [
    {
      "docId": "...",
      "hierarchy": ["Shop", "USIMeSIM가입", "선불 USIM 구매충전"],
      "input_tokens": 2785,
      "output_tokens": 709,
      "qa_list": [
        { "q": "...", "a": "...", "intent": "procedure", "answerable": true }
      ]
    }
  ]
}
```

### 비용 요약 (1,106개 QA 생성 기준)

| 구성                        | 입력 토큰 | 출력 토큰 | 총 비용 | 품질 | 추천 |
| ----------------------------- | --------- | --------- | ------- | ---- | ---- |
| **Flash-Lite EN** (권장)    | ~350k     | ~175k     | **$1.19**   | 4.92 | ⭐⭐⭐⭐⭐ |
| **GPT-5.1 EN** (대안)       | ~350k     | ~175k     | **$8.17**   | 4.94 | ⭐⭐⭐ |
| ~~Gemini 2.5 Flash~~ (구)   | —         | —         | —       | —    | ❌ |
| ~~Claude Sonnet 4.5~~ (구)  | —         | —         | —       | —    | ❌ |

**절감액**: Flash-Lite 선택 시 $6.98 절감

---

## 2.5단계: QA 품질 검증 (`eval_qa_quality.py`)

RAGAS 평가 전에 DeepEval + Validator LLM으로 생성된 Q&A 자체의 품질을 검증하는 단계.
저품질 QA를 걸러낸 후 RAGAS에 투입함으로써 평가 신뢰도를 높인다.

### 왜 필요한가

QA 생성 LLM이 만든 Q&A는 아래 문제가 발생할 수 있음:

- **Hallucination**: 컨텍스트에 없는 수치/사실을 꾸며서 답변 (예: "1100%" 오류)
- **Non-atomic**: 질문 하나에 여러 개념이 섞임
- **Low coherence**: 질문과 답변이 논리적으로 불일치
- **Unanswerable**: `answerable: true`로 표시됐지만 실제로 컨텍스트로 답변 불가

### 추가 설치

```bash
uv add deepeval
```

### 평가 기준 (Criteria)

DeepEval의 `GEval`로 아래 4개 기준을 Validator LLM이 채점.

| 기준                       | 설명                                               | 통과 기준    |
| -------------------------- | -------------------------------------------------- | ------------ |
| **Groundedness**     | 답변이 컨텍스트에 근거하는가 (외부 지식 사용 여부) | score ≥ 0.7 |
| **Answer Relevance** | 답변이 질문에 직접 답하는가                        | score ≥ 0.7 |
| **Atomicity**        | 질문이 단일 개념/과업에 집중하는가                 | score ≥ 0.7 |
| **Clarity**          | 질문이 모호하지 않고 명확한가                      | score ≥ 0.6 |

### 구현 계획

```python
from deepeval import evaluate
from deepeval.metrics import GEval
from deepeval.metrics.g_eval import GEvalInputs
from deepeval.test_case import LLMTestCase
from langchain_google_genai import ChatGoogleGenerativeAI

# Validator LLM: Gemini 2.5 Flash (비용 절감)
validator_llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash")

# 평가 기준 정의
groundedness_metric = GEval(
    name="Groundedness",
    criteria="The answer must be solely based on the given context. "
             "Penalize heavily if any fact or figure in the answer cannot be verified from the context.",
    evaluation_params=[GEvalInputs.INPUT, GEvalInputs.ACTUAL_OUTPUT, GEvalInputs.CONTEXT],
    minimum_score=0.7,
    model=validator_llm,
)

answer_relevance_metric = GEval(
    name="AnswerRelevance",
    criteria="The answer must directly and completely address the question asked. "
             "Penalize if the answer is off-topic or only partially addresses the question.",
    evaluation_params=[GEvalInputs.INPUT, GEvalInputs.ACTUAL_OUTPUT],
    minimum_score=0.7,
    model=validator_llm,
)

atomicity_metric = GEval(
    name="Atomicity",
    criteria="The question must target exactly one concept or task. "
             "Penalize if the question contains multiple sub-questions or requires multiple distinct answers.",
    evaluation_params=[GEvalInputs.INPUT],
    minimum_score=0.7,
    model=validator_llm,
)

# QA JSON 로드 → DeepEval TestCase 변환
test_cases = []
for result in qa_results:
    context = [result.get("text", "")]  # 원본 컨텍스트
    for qa in result.get("qa_list", []):
        test_cases.append(LLMTestCase(
            input=qa["q"],
            actual_output=qa["a"],
            context=context,
            additional_metadata={"docId": result["docId"], "intent": qa["intent"]},
        ))

# 평가 실행
results = evaluate(
    test_cases,
    metrics=[groundedness_metric, answer_relevance_metric, atomicity_metric],
)

# 통과한 QA만 필터링
validated = [tc for tc in results if tc.success]
```

### 출력 형식

```json
{
  "source_file": "output/test_gen2-2_20260306_152528.json",
  "total_qa": 15,
  "passed_qa": 12,
  "pass_rate": 0.80,
  "items": [
    {
      "docId": "...",
      "q": "...",
      "a": "...",
      "intent": "procedure",
      "groundedness": 0.92,
      "answer_relevance": 0.88,
      "atomicity": 0.95,
      "passed": true
    }
  ]
}
```

저장 경로: `validated_output/validated_{원본파일명}.json`

### Validator LLM 선택

| LLM               | 비용                    | 비고                        |
| ----------------- | ----------------------- | --------------------------- |
| Gemini 2.5 Flash  | 저렴 ($0.30/$2.50 MTok) | **기본 권장**         |
| Gemini 2.5 Pro    | 중간                    | 판단이 어려운 경우 fallback |
| Claude Sonnet 4.5 | 고가 ($3/$15 MTok)      | 최고 품질 필요 시           |

> 검증 자체도 LLM 호출이므로 비용 발생. 1,106개 × 3 QA = 3,318 케이스 기준 Gemini Flash로 약 **$0.5~1** 예상.

### RAGAS와의 역할 구분

|           | DeepEval (2.5단계)              | RAGAS (3단계)                          |
| --------- | ------------------------------- | -------------------------------------- |
| 평가 대상 | **생성된 QA 자체**의 품질 | **RAG 시스템**의 검색·답변 품질 |
| 입력      | Q, A, 원본 컨텍스트             | Q, A, retrieved_contexts               |
| 목적      | 저품질 QA 필터링                | 모델/프롬프트 비교                     |
| 실행 시점 | QA 생성 직후                    | Chroma 인덱싱 후                       |

---

## 3단계: RAG 평가 — RAGAS + RAG Triad 병행

두 프레임워크를 함께 실행하여 결과를 교차 검증한다.

### 3-A. RAGAS (`eval_ragas.py`)

#### 평가 지표

| 지표                  | RAG Triad 대응       | 설명                                  |
| --------------------- | -------------------- | ------------------------------------- |
| `faithfulness`      | Groundedness ✅      | 답변이 retrieved context에 근거하는가 |
| `context_precision` | Context Relevance ✅ | 검색된 context 중 관련 있는 비율      |
| `answer_relevancy`  | Answer Relevance ✅  | 답변이 질문에 관련 있는가             |
| `context_recall`    | (RAGAS 고유)         | ground_truth가 contexts에 커버되는가  |

#### 구현 계획

```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_precision, context_recall
from langchain_chroma import Chroma
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from datasets import Dataset

embeddings = GoogleGenerativeAIEmbeddings(model="models/text-embedding-004")
vectorstore = Chroma(persist_directory="./chroma_db", embedding_function=embeddings)
retriever   = vectorstore.as_retriever(search_kwargs={"k": 3})

rows = []
for result in qa_results:
    for qa in result["qa_list"]:
        contexts = retriever.invoke(qa["q"])
        rows.append({
            "question":     qa["q"],
            "answer":       qa["a"],
            "contexts":     [c.page_content for c in contexts],
            "ground_truth": qa["a"],
        })

dataset = Dataset.from_list(rows)
llm     = ChatGoogleGenerativeAI(model="gemini-2.5-flash")

ragas_result = evaluate(
    dataset,
    metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
    llm=llm,
    embeddings=embeddings,
)
```

---

### 3-B. RAG Triad — DeepEval (`eval_triad.py`)

TruLens(`rich<14.0` 의존성 충돌)를 대신해 **이미 설치된 DeepEval**로 RAG Triad를 평가한다.
DeepEval은 RAG Triad 3개 지표를 네이티브 메트릭으로 제공하며, 2.5단계(QA 품질 검증)와 패키지가 동일하다.

#### 추가 설치

```bash
# 없음 — deepeval 이미 설치됨
```

#### RAG Triad ↔ DeepEval 메트릭 대응

| RAG Triad         | DeepEval 메트릭               | 설명                                |
| ----------------- | ----------------------------- | ----------------------------------- |
| Context Relevance | `ContextualRelevancyMetric` | 검색된 context가 질문과 관련 있는가 |
| Groundedness      | `FaithfulnessMetric`        | 답변이 context에 근거하는가         |
| Answer Relevance  | `AnswerRelevancyMetric`     | 답변이 질문에 직접 답하는가         |

#### 구현 계획

```python
from deepeval import evaluate
from deepeval.metrics import (
    ContextualRelevancyMetric,
    FaithfulnessMetric,
    AnswerRelevancyMetric,
)
from deepeval.test_case import LLMTestCase
from langchain_chroma import Chroma
from langchain_google_genai import GoogleGenerativeAIEmbeddings

embeddings  = GoogleGenerativeAIEmbeddings(model="models/text-embedding-004")
vectorstore = Chroma(persist_directory="./chroma_db", embedding_function=embeddings)
retriever   = vectorstore.as_retriever(search_kwargs={"k": 3})

# RAG Triad 메트릭 (Validator: Gemini 2.5 Flash)
ctx_relevancy  = ContextualRelevancyMetric(threshold=0.7, model="gemini/gemini-2.5-flash")
faithfulness   = FaithfulnessMetric(threshold=0.7,        model="gemini/gemini-2.5-flash")
ans_relevancy  = AnswerRelevancyMetric(threshold=0.7,     model="gemini/gemini-2.5-flash")

# QA JSON → DeepEval TestCase 변환
test_cases = []
for result in qa_results:
    for qa in result["qa_list"]:
        contexts = retriever.invoke(qa["q"])
        ctx_texts = [c.page_content for c in contexts]
        test_cases.append(LLMTestCase(
            input=qa["q"],
            actual_output=qa["a"],
            retrieval_context=ctx_texts,
        ))

# 평가 실행
triad_results = evaluate(
    test_cases,
    metrics=[ctx_relevancy, faithfulness, ans_relevancy],
)
```

---

### 3-C. 두 프레임워크 비교

|                   | **RAGAS**                   | **DeepEval RAG Triad** |
| ----------------- | --------------------------------- | ---------------------------- |
| 설치              | `ragas`                         | `deepeval` (이미 설치)     |
| 평가 방식         | 데이터셋 기반 배치 평가           | TestCase 기반 배치 평가      |
| RAG Triad 커버    | ✅ (3개 +`context_recall` 추가) | ✅ (RAG Triad 네이티브)      |
| QA 품질 검증 연계 | ❌ 별도                           | ✅ 2.5단계와 동일 패키지     |
| 출력              | DataFrame                         | TestCase 결과 + pass/fail    |
| 적합 용도         | 수치 집계, 지표 비교              | 항목별 pass/fail 디버깅      |

> 두 프레임워크 결과가 일치하면 → 신뢰도 높음
> 결과가 크게 다르면 → 각 프레임워크의 프롬프트 설계 차이가 원인 → 심층 분석 필요

---

## 4단계: 결과 분석

### 비교 목표

- **모델 비교**: Flash-Lite EN vs GPT-5.1 EN → 품질 차이 (정량: 0.02/5) vs 비용 차이 (6.9배) 분석
- **RAG 평가**: RAGAS vs RAG Triad 지표가 같은 방향 수렴하는가?
- **실무 적용**: Flash-Lite EN으로 생성한 QA 기반 RAG 시스템 성능 검증

### 출력 형식

```
스크립트                faithfulness  ctx_precision  ctx_recall  ans_relevancy  │  ctx_rel(Triad)  faithfulness  ans_rel(Triad)
test_gen_flashlite_en      0.XX          0.XX          0.XX          0.XX       │     0.XX            0.XX          0.XX
test_gen_gpt51_en          0.XX          0.XX          0.XX          0.XX       │     0.XX            0.XX          0.XX
                          ←────────────── RAGAS ──────────────────→             │  ←──────── RAG Triad (DeepEval) ───────→
```

---

## Vector DB 선택 근거

|                   | InMemoryVectorStore | **Chroma (채택)** | Qdrant   |
| ----------------- | ------------------- | ----------------------- | -------- |
| 설치              | 추가 없음           | `chromadb`            | Docker   |
| 영속성            | ❌ 재시작 시 소멸   | ✅ 디스크 저장          | ✅       |
| 1,106개 규모 적합 | ⭐⭐⭐              | ⭐⭐⭐⭐⭐              | ⭐⭐⭐⭐ |
| 임베딩 재사용     | ❌ 매 실행 재계산   | ✅ 1회 인덱싱 후 재사용 | ✅       |

**Chroma 선택 이유**: 1,106개 규모에 충분하고, 로컬 디스크에 영속하여 임베딩 비용을 최초 1회만 발생.

---

## Mock DB (InMemoryVectorStore) 활용 방안

Chroma를 쓰기 전 또는 쓸 수 없는 상황에서 빠르게 파이프라인을 검증할 때 사용.
**추가 설치 없음** — `langchain-core` 내장.

### 언제 쓰는가

| 상황                          | 이유                                                |
| ----------------------------- | --------------------------------------------------- |
| `build_index.py` 첫 구축 전 | Chroma 없이 eval_ragas.py 로직 먼저 검증            |
| CI/CD 단위 테스트             | 디스크 I/O 없이 빠른 파이프라인 smoke test          |
| 새 도메인 도입 초기           | 크롤링·정규화 완료 전 소규모 샘플로 빠른 품질 확인 |
| 임베딩 모델 교체 비교         | 여러 모델을 실행마다 바꿔가며 retrieval 품질 비교   |

### 코드 패턴

```python
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_google_genai import GoogleGenerativeAIEmbeddings

embeddings = GoogleGenerativeAIEmbeddings(model="models/text-embedding-004")

# 소규모 샘플(예: 20개)로 빠르게 로드
sample_texts = [item["text"] for item in data[:20] if item.get("text")]
sample_meta  = [{"docId": item["docId"], "hierarchy": " > ".join(item["hierarchy"])}
                for item in data[:20] if item.get("text")]

vectorstore = InMemoryVectorStore.from_texts(
    sample_texts,
    embeddings,
    metadatas=sample_meta,
)
retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
```

### Chroma와 교체 방법

retriever 인터페이스가 동일하므로 **단 1줄만 교체**하면 전환됨.

```python
# Mock DB (개발/테스트용)
retriever = InMemoryVectorStore.from_texts(texts, embeddings).as_retriever(k=3)

# Chroma (운영용) — 나머지 코드 변경 없음
retriever = Chroma(persist_directory="./chroma_db", embedding_function=embeddings).as_retriever(search_kwargs={"k": 3})
```

### 주의사항

- 재시작 시 데이터 소멸 → 매 실행마다 임베딩 비용 재발생
- 1,106개 전체를 Mock DB에 올리면 실행 시간 ~2~3분 (임베딩 API 호출) + 메모리 상주
- **50개 미만 샘플 검증용**으로만 사용하고, 본 평가는 Chroma로 진행 권장

---

## 작업 순서 (TODO)

- [X] QA 생성 스크립트 설계 + 6~10개 모델 테스트 평가
- [X] 최적 모델 선정: Flash-Lite EN + GPT-5.1 EN
- [ ] `build_index.py` — Chroma 인덱싱 (1회)
- [ ] `test_gen_flashlite_en.py` — Flash-Lite EN으로 1,106개 QA 생성 (주 후보)
- [ ] `test_gen_gpt51_en.py` — GPT-5.1 EN으로 1,106개 QA 생성 (비교 대안)
- [ ] `eval_qa_quality.py` — DeepEval QA 품질 검증 + 필터링
- [ ] `eval_ragas.py` — RAGAS 평가 (검증된 QA 사용)
- [ ] `eval_triad.py` — RAG Triad (DeepEval) 평가
- [ ] 결과 비교 리포트 작성 (RAGAS + RAG Triad 교차 검증)

---

## 부록: 추가 데이터 수집이 필요한 경우

현재 `data_2026-03-06_normalized.json` (1,106개)은 이미 크롤링 + 전처리가 완료된 상태.
아래 상황 발생 시 재수집 파이프라인이 필요하다.

### 케이스 1: KT.com 페이지 내용 업데이트

요금제·혜택 정보는 수시로 변경됨. 오래된 문서로 생성한 QA는 현실과 불일치 가능성 있음.

```
트리거: 요금제 개편, 혜택 변경, 시즌 이벤트 등
주기 : 월 1회 또는 이벤트 발생 시
```

**대응 방법**

1. 기존 `scraped_results/` 구조 참고하여 동일 URL 재크롤링
2. 변경된 항목만 diff 비교 후 선택적 업데이트
3. Chroma DB `update()` 또는 컬렉션 재구축

---

### 케이스 2: 현재 JSON에 없는 페이지 추가

1,106개는 특정 시점의 사이트맵 기준 수집. 신규 페이지·카테고리 추가 시 누락 발생.

```
예: 신규 요금제 출시, 신규 부가서비스 페이지, 신규 이벤트 카테고리
```

**대응 방법**

1. KT.com 사이트맵 또는 카테고리 트리 재스캔
2. 기존 `category.csv` / `hierarchy.csv` 와 비교하여 신규 항목 식별
3. 신규 URL만 선택적 크롤링 후 JSON에 append
4. 정규화 스크립트 재실행 → Chroma DB에 추가 인덱싱

```python
# 기존 DB에 신규 문서만 추가 (재구축 불필요)
vectorstore = Chroma(persist_directory="./chroma_db", embedding_function=embeddings)
vectorstore.add_documents(new_docs)
```

---

### 케이스 3: 프로덕션 서비스 배포 시 주기적 갱신

실제 RAG 서비스로 배포할 경우 문서 최신성 보장 필요.

```
권장 구조:
  - 스케줄러(cron/Airflow) → 크롤링 → 전처리 → diff 감지 → Chroma 업데이트
  - 변경 이력 관리: doc별 hash 비교로 불필요한 재임베딩 방지
```

| 단계     | 도구                     | 비고                           |
| -------- | ------------------------ | ------------------------------ |
| 크롤링   | requests + BeautifulSoup | 기존 scraped_results 참고      |
| 전처리   | markdownify / html2text  | 기존 preprocessed_results 참고 |
| 정규화   | 기존 정규화 스크립트     | docId 체계 유지                |
| 인덱싱   | Chroma `add_documents` | 변경분만 업데이트              |
| 스케줄링 | GitHub Actions cron      | 가벼운 주기 실행에 적합        |

---

### 케이스 4: 도메인 확장 (타 통신사·서비스)

다른 도메인에 동일 파이프라인 적용 시 처음부터 수집 필요.

**수집 → 평가 전체 흐름**

```
[크롤링]    대상 URL 목록 정의 → HTML 수집 → 로컬 저장
[전처리]    HTML → Markdown → 불필요 요소 제거 (로그인 유도, 네비바 등)
[정규화]    { docId, url, hierarchy, title, text } JSON 구성
[인덱싱]    build_index.py 실행 → Chroma DB 구축
[QA 생성]   test_gen*.py 실행
[평가]      eval_ragas.py 실행
```

> **주의**: 크롤링 시 robots.txt 준수 및 요청 간격(sleep) 설정 필수.

---

## 부록 2: 타 도메인 적용 시 체크리스트

현재 파이프라인은 KT.com 구조에 일부 의존하고 있어, 다른 사이트에 적용할 경우 아래 항목을 점검해야 한다.

### 1. 사이트 구조 파악

| 항목          | KT.com 현재값                       | 신규 도메인 확인 사항                             |
| ------------- | ----------------------------------- | ------------------------------------------------- |
| 계층 구조     | hierarchy 5단계 (Shop > ... > 상세) | 카테고리 트리 깊이·명칭 확인                     |
| 로그인 페이지 | `"로그인 \| KT"` 패턴              | 로그인 리다이렉트 URL/텍스트 패턴 재정의          |
| 에러 페이지   | `"페이지를 찾을 수 없"`           | 404/에러 페이지 식별 패턴 재정의                  |
| 모바일 URL    | `m.shop.kt.com` 분리              | 모바일/데스크탑 URL 중복 여부 확인                |
| 본문 추출     | Markdown 변환 후 text 필드          | 사이트별 본문 선택자(CSS selector) 조정 필요 가능 |

### 2. `is_valid()` 필터 수정

현재 4개 스크립트에 하드코딩된 SKIP_KEYWORDS와 MIN_TEXT_LEN을 도메인에 맞게 수정.

```python
# 현재 (KT.com 전용)
SKIP_KEYWORDS = ["로그인 | KT", "로그인| KT", "페이지를 찾을 수 없", "error", "접근이 제한"]
MIN_TEXT_LEN = 200

# 타 도메인 예시 (SKT)
SKIP_KEYWORDS = ["로그인 | SK텔레콤", "이용 권한이 없습니다", "error"]
MIN_TEXT_LEN = 200  # 동일하게 유지하거나 도메인 특성에 맞게 조정
```

### 3. SYSTEM_PROMPT 도메인 문구 수정

현재 프롬프트에 "KT" 고유 문구가 포함되어 있어 교체 필요.

```python
# 현재 (한국어 버전)
"당신은 통신사 고객지원 QA 데이터셋 생성 전문가입니다."

# 타 도메인 예시
"당신은 [도메인명] 고객지원 QA 데이터셋 생성 전문가입니다."

# 현재 (영어 버전)
"You are a QA dataset generation expert for Korean telecom (KT) customer support."

# 타 도메인 예시
"You are a QA dataset generation expert for [domain description] customer support."
```

### 4. Chroma DB 분리

도메인별로 별도 컬렉션 또는 디렉토리에 인덱싱하여 혼용 방지.

```python
# KT.com
vectorstore = Chroma(persist_directory="./chroma_db/kt", ...)

# 타 도메인 (예: SKT)
vectorstore = Chroma(persist_directory="./chroma_db/skt", ...)
```

### 5. 출력 파일 네이밍 컨벤션

현재 `test_gen1-1_*.json` 패턴은 모델/프롬프트 구분만 있고 도메인 구분이 없음.
도메인이 추가될 경우 아래 패턴 확장 권장.

```
현재:  output/test_gen{모델}-{프롬프트}_{timestamp}.json
확장:  output/{도메인}/test_gen{모델}-{프롬프트}_{timestamp}.json

예:    output/kt/test_gen1-2_20260306_155243.json
       output/skt/test_gen1-2_20260306_160000.json
```

### 6. 도메인별 설정 파일 분리 (권장)

도메인이 2개 이상으로 늘면 각 스크립트마다 수동 수정하는 것을 피하기 위해 설정 파일로 분리.

```python
# config/kt.yaml
domain: kt
skip_keywords:
  - "로그인 | KT"
  - "페이지를 찾을 수 없"
min_text_len: 200
system_prompt_ko: "당신은 KT 통신사 고객지원 QA 데이터셋 생성 전문가입니다."
system_prompt_en: "You are a QA dataset generation expert for Korean telecom (KT)."
chroma_dir: ./chroma_db/kt
output_dir: ./output/kt
data_path: ref/data/data_2026-03-06_normalized.json
```
