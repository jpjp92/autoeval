# 레퍼런스 논문 분석 및 프로젝트 적용 방안

**논문**: Large Language Models as Test Case Generators: Performance Evaluation and Enhancement
**출처**: arXiv:2404.13340v1 (2024-04-20), Kefan Li & Yuan Yuan (Beihang University)
**원문**: `2404.13340v1.pdf` / `ref/2404.13340v1.txt`
**작성일**: 2026-03-06

---

## 1. 논문 원문 요약 (사실 기반)

### 1.1 논문이 풀려는 문제

Python 함수(LeetCode, HumanEval)에 대한 **unit test case 자동 생성** — 즉 함수 입력값과 기대 출력값의 쌍(`assert func(input) == output`)을 LLM이 올바르게 만들 수 있는가를 연구.

> 우리 프로젝트 도메인(통신사 문서 QA)과 다르다. 적용 시 도메인 차이를 명확히 의식해야 함.

### 1.2 핵심 발견

- LLM이 test case를 틀리는 주된 원인: **Assertion Error** (입력값은 잘 만들지만 정답 출력값 계산에서 실패)
- GPT-4도 LeetCode-hard에서 정확도 ~58% (HumanEval ~85% 대비 급락)
- **문제 난이도가 올라갈수록 LLM 단독으로는 신뢰할 수 없음**

### 1.3 TestChain 실제 구조

논문이 제안하는 프레임워크는 **2개 에이전트**로 구성됨 :

```
Designer Agent (1회 호출)
  입력: 함수 정의 + docstring
  목적: basic + edge 테스트 입력값 목록만 생성 (출력값 계산 없음)
  출력: [input1, input2, input3, ...]
         ↓ 각 입력값마다
Calculator Agent (입력값 수만큼 반복 호출)
  입력: 함수 정의 + 테스트 입력값 1개
  목적: ReAct 루프로 정확한 출력값 계산
         Thought → Python 코드 작성 → 실행(인터프리터) → Observation → 반복
  출력: assert func(input) == output
```

**핵심 설계 원칙 2가지:**

1. **Decoupling**: 입력 생성 / 출력 계산을 별도 에이전트로 분리 → 각자 해당 역할만 집중
2. **Python 인터프리터 연동 (ReAct)**: 수치 계산을 LLM 추론이 아닌 실제 실행으로 검증

### 1.4 성능 결과 (Table 2, LeetCode-hard 기준)

| 방법                                 | Accuracy                   |
| ------------------------------------ | -------------------------- |
| Test Agent 1-shot (baseline)         | 57.95%                     |
| TestChain (분리만, no-py)            | 61.54% (+3.59%)            |
| TestChain (분리 + Python 인터프리터) | **71.79% (+13.84%)** |

→ 성능 향상의 대부분은 Python 인터프리터 연동에서 나옴

### 1.5 한계

논문이 명시한 한계: "TestChain은 GPT-3.5/GPT-4 수준의 강력한 모델에 한해 작동. 약한 모델에 대한 확장은 미래 과제."

---

## 2. 외부 분석 검토 (사실 vs. 창작 구분)

외부 LLM이 제공한 "Multi-Proxy 설계안"과 논문 원문의 차이:

| 항목            | 논문 원문                                  | 외부 분석                     |
| --------------- | ------------------------------------------ | ----------------------------- |
| 에이전트 수     | **2개** (Designer + Calculator)      | 3개 (+ Validator 추가)        |
| Validator 존재  | **없음**                             | 추가 제안 (아이디어)          |
| Calculator 역할 | ReAct + Python 실행으로**수치 계산** | "Generator"로 재명명          |
| Designer 역할   | 테스트**입력값만** 생성              | 카테고리별 전략 수립으로 확장 |
| Feedback loop   | **단방향** (Validator 없음)          | 재귀적 피드백 루프 추가 제안  |

> 외부 분석 내용은 논문 아이디어를 우리 도메인으로 **창의적으로 확장**한 것으로, 논문 내용 자체는 아님.
> 단, 아이디어 자체는 참고할 가치가 있음.

---

## 3. 우리 프로젝트 적용 방안

### 3.1 도메인 매핑

| TestChain 원소                | 우리 프로젝트 대응                                 |
| ----------------------------- | -------------------------------------------------- |
| 함수 정의 + docstring         | `hierarchy` + `title` (문서 식별자)            |
| 테스트 입력값                 | 사용자 질문 (Q)                                    |
| 기대 출력값 계산              | 원본 `text`에서 답변 추출 (A)                    |
| Python 인터프리터 (수치 검증) | 원본 text에서 수치/조건 텍스트 검색 (Fact Filter)  |
| Assertion Error 방지          | Hallucination 방지 (답변이 원문에 근거하는지 확인) |

### 3.2 권고 아키텍처 (논문 원칙 기반)

```
[Phase 1] Question Agent  ← Designer에서 영감
  입력: item['hierarchy'] + item['title']
  역할: 질문만 생성 (답변 내용 고려 없이)
        "답변하기 쉬운 질문"을 만드는 편향 방지 효과
  출력: [Q1, Q2, Q3, Q4, Q5]

[Phase 2] Answer Agent  ← Calculator에서 영감
  입력: item['text'] + 질문 1개  ← 질문마다 별도 호출
  역할: 원문에서 해당 질문의 답변 도출
  출력: A1, A2, A3, A4, A5

[Phase 3] Fact Filter  ← ReAct 정신 차용
  입력: 답변 + 원본 item['text']
  역할: 답변 내 수치/조건이 원문에 실제 존재하는지 검증
  결과: pass → 채택 / fail → Phase 2 재호출 (최대 2회)
```

### 3.3 카테고리별 질문 생성 전략 (외부 분석 아이디어 채택)

논문에는 없지만 우리 데이터 특성상 유효한 접근:

| 대분류   | 비중  | 질문 페르소나                | 핵심 포인트                     |
| -------- | ----- | ---------------------------- | ------------------------------- |
| 상품     | 48.5% | 가입을 고민 중인 잠재 고객   | 요금, 결합 할인 조건의 정확성   |
| 고객지원 | 27.3% | 문제를 겪고 있는 기존 고객   | 단계별 해결 절차 (Step-by-Step) |
| Shop     | 15.2% | 즉시 구매/가입을 원하는 고객 | 구매 절차, 링크 유효성          |
| 혜택     | 8.9%  | 이벤트 참여를 원하는 고객    | 참여 기간, 대상자 조건          |

### 3.4 프롬프트 설계 방향

논문의 **1-shot 프롬프트** 방식 채택 권고 (0-shot 대비 명확한 품질 향상 확인됨):

```
[Phase 1 - Question Agent 프롬프트 구조]
System: "너는 KT 서비스 큐레이터다. 주어진 카테고리와 제목을 보고,
         {페르소나}가 가장 궁금해할 질문 5개를 생성하라. 답변은 고려하지 말 것."
1-shot: {카테고리 예시 + 질문 5개 예시}
User: hierarchy={hierarchy}, title={title}

[Phase 2 - Answer Agent 프롬프트 구조]
System: "너는 KT 고객 상담사다. 제공된 문서 내용만을 근거로 질문에 답하라.
         문서에 없는 내용은 절대 추가하지 말 것."
1-shot: {문서 예시 + Q/A 예시}
User: [문서 내용]\n\n질문: {Q}
```

### 3.5 Validator Agent (필수)

논문에는 없지만 **우리 프로젝트에서 반드시 필요한 레이어**. 이유:
- LLM은 원문에 없는 정보를 자연스럽게 지어낸다 (Hallucination)
- Q/A를 동시에 대량 생성하면 오류 데이터가 섞여도 육안으로 발견이 어렵다
- 검증 없이 RAG 평가 데이터로 쓰면 평가 결과 자체가 신뢰 불가

#### Validator가 검증해야 할 항목

| 검증 항목 | 판단 기준 | 판정 |
|---|---|---|
| **Faithfulness** | 답변에 포함된 수치(요금, 기간, 조건)가 원본 text에 존재하는가 | FAIL이면 재생성 |
| **Relevance** | 답변이 질문에 직접 대답하는가 (주제 이탈 여부) | FAIL이면 재생성 |
| **Completeness** | 질문에 답하기 위한 핵심 정보가 누락되지 않았는가 | WARNING 표시 |
| **Question Quality** | 질문이 원문 내용에서 실제로 답할 수 있는 질문인가 | FAIL이면 Q 재생성 |
| **Diversity** | 5개 질문이 서로 다른 관점을 다루는가 (중복 여부) | WARNING 표시 |

#### Validator 프롬프트 구조

```
[Phase 3 - Validator Agent 프롬프트]

System:
"너는 QA 데이터 품질 검수자다.
규칙:
 1. 답변에 포함된 모든 수치, 날짜, 조건, 가격은 반드시 [원문]에 있어야 한다.
    원문에 없는 정보가 하나라도 있으면 Faithfulness = FAIL.
 2. 답변이 질문의 핵심을 직접 해소하지 않으면 Relevance = FAIL.
 3. 질문이 원문만으로 답할 수 없는 내용이면 QuestionQuality = FAIL.
FAIL 판정 시 구체적인 수정 지시사항을 JSON으로 반환하라."

User:
[원문]
{item['text']}

[질문]
{Q}

[답변]
{A}

기대 출력 (JSON):
{
  "faithfulness": "PASS" | "FAIL",
  "relevance": "PASS" | "FAIL",
  "question_quality": "PASS" | "FAIL",
  "fail_reason": "FAIL인 경우 구체적 이유",
  "fix_instruction": "재생성 시 반영할 수정 지시사항"
}
```

#### Validator 흐름도

```
Phase 1: 질문 5개 생성
    ↓
Phase 2: 답변 생성 (질문마다 별도 호출)
    ↓
Phase 3: Validator 검증
    ├─ PASS → QA 쌍 최종 채택
    └─ FAIL → fix_instruction과 함께 Phase 2 재호출
                  ↓ 최대 2회 재시도
                  여전히 FAIL → 해당 QA 쌍을 "review_needed" 플래그로 저장
                               → 수동 검토 대상
```

#### 최종 출력 데이터 스키마

```json
{
  "docId": "ktcom_xxxx",
  "hierarchy": ["상품", "모바일", "요금제", "5G"],
  "title": "5G 요금제",
  "qa_pairs": [
    {
      "question": "5G 요금제 월 기본료는 얼마인가요?",
      "answer": "5G 요금제 월 기본료는 55,000원입니다.",
      "validator": {
        "faithfulness": "PASS",
        "relevance": "PASS",
        "question_quality": "PASS"
      },
      "status": "approved"   // "approved" | "review_needed"
    }
  ]
}
```

### 3.5 평가 지표

논문의 Accuracy/Line Coverage/CwB는 코드 테스트 전용. 우리 프로젝트 적용 지표:

| 지표                         | 설명                                   | 논문 대응                          | 임계치 |
| ---------------------------- | -------------------------------------- | ---------------------------------- | ------ |
| **Faithfulness**       | 답변의 모든 내용이 원문에 근거하는가   | Assertion Error 방지과 동일 목적   | ≥ 0.8  |
| **Answer Relevancy**   | 질문에 대해 직접적인 해답을 제공하는가 | Accuracy 대응                      | ≥ 0.7  |
| **Question Diversity** | 5개 질문이 서로 다른 관점을 다루는가   | Line Coverage 대응 (커버리지 개념) | 정성 판단 |

→ **RAGAS** 프레임워크 사용 권고 (Phase 3 Validator 전용 — TestSet Generation 기능은 한국어 최적화 미흡으로 미사용)

### 3.6 모델 선택 전략

역할별로 모델을 분리해 비용과 품질을 최적화:

| 역할 | 추천 모델 | 이유 |
|------|-----------|------|
| **생성 (Phase 1+2)** | `gemini-2.5-pro`, `gemini-3-flash` | 복잡한 문서 이해 + 고품질 QA 생성 |
| **평가 (Phase 3 RAGAS)** | `gemini-2.5-flash`, `gemini-2.5-flash-lite` | claim 판단은 단순 작업 → 저렴·빠름 |

#### RAGAS + Gemini 설정

```python
import os
from google import genai
from ragas.llms import llm_factory
from ragas.embeddings import GoogleEmbeddings
from ragas.metrics.collections import Faithfulness, AnswerRelevancy

# 평가 전용 LLM (저비용)
client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
eval_llm    = llm_factory("gemini-2.5-flash", provider="google", client=client)
embeddings  = GoogleEmbeddings(client=client, model="gemini-embedding-001")

# 메트릭 (Faithfulness는 LLM만, AnswerRelevancy는 embedding도 필요)
faithfulness  = Faithfulness(llm=eval_llm)
answer_rel    = AnswerRelevancy(llm=eval_llm, embeddings=embeddings)

FAITHFULNESS_THRESHOLD = 0.8
RELEVANCY_THRESHOLD    = 0.7
```

> **Troubleshooting**: `google-genai` 신버전 SDK와 `instructor` 라이브러리 충돌 시
> (`HARM_CATEGORY_JAILBREAK` 에러) → OpenAI 호환 엔드포인트로 우회:
> ```python
> from openai import OpenAI
> client = OpenAI(
>     api_key=os.environ["GOOGLE_API_KEY"],
>     base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
> )
> eval_llm = llm_factory("gemini-2.5-flash", provider="openai", client=client)
> ```

#### Phase 3 통합 재생성 루프

```python
async def phase3_validate(item, question, answer, retry_count=0):
    scores = {
        "faithfulness": await faithfulness.ascore(
            user_input=question,
            response=answer,
            retrieved_contexts=[item['text'].replace('\\n', '\n')]
        ),
        "relevancy": await answer_rel.ascore(
            user_input=question,
            response=answer
        )
    }
    if scores["faithfulness"] < FAITHFULNESS_THRESHOLD or \
       scores["relevancy"] < RELEVANCY_THRESHOLD:
        if retry_count < 2:
            new_answer = await phase2_generate_answer(item, question, hint=scores)
            return await phase3_validate(item, question, new_answer, retry_count + 1)
        else:
            return {"status": "review_needed", "scores": scores, "answer": answer}
    return {"status": "approved", "scores": scores, "answer": answer}
```

---

## 4. 실행 단계 제안 (외부 분석 로드맵 참고)

| 단계                        | 내용                                                            | 기준           |
| --------------------------- | --------------------------------------------------------------- | -------------- |
| **1. 샘플 테스트**    | 카테고리별 5개씩 총 20개 노드 선발, 3-Phase 파이프라인 1회 가동 | 프롬프트 튜닝  |
| **2. 평가 기준 수립** | RAGAS 기반 Faithfulness / Relevance / Diversity 점수 기준 확정  | 기준점 수립    |
| **3. 소규모 배치**    | 카테고리별 50개씩 200개 처리, 품질 분포 확인                    | 배치 전략 검증 |
| **4. 전체 배치**      | 전체 1,106개 병렬 처리                                          | 본 생산        |
| **5. 하위 품질 보정** | Fact Filter fail 항목 + 하위 5% 수동 검토                       | 품질 보증      |

---

## 5. 논문에서 얻은 중요 교훈

1. **"생성량"보다 "생성 정확도"가 먼저다**: GPT-4도 어려운 문제에서 42% 오류 발생. 검증 없이 대량 생성하면 오류 데이터가 대량 포함됨.
2. **역할 분리(Decoupling)의 효과는 실증됨**: Q+A 동시 생성보다 Q 먼저, 그 다음 A 별도 생성이 품질이 높다.
3. **1-shot 예시의 효과**: 각 카테고리별 잘 만든 예시 1개를 포함하는 것만으로 GPT-3.5 기준 +12% 향상.
4. **단방향 생성보다 검증-재생성 루프**: 논문의 Calculator Agent가 최대 5회 반복한 것처럼, 검증에 실패한 답변은 재생성하는 루프가 전체 품질을 끌어올림.

---

**참고 파일**: `ref/2404.13340v1.txt` (전문 텍스트), `2404.13340v1.pdf` (원본)
