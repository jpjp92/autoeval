# 내부 QA셋 생성 프로젝트 기획 (2026-06-29)

> 외부 문서 기반 AutoEval 프로덕션과 별도로, 회사 내부망에서 실사용자 발화 로그와 내부 컨텍스트를 기반으로 QA/라우팅/응답 평가셋을 생성하는 프로젝트 구상

---

## 1. 배경

현재 프로덕션 구조는 외부 사용을 전제로 한다.

```text
PDF/DOCX 업로드
→ 문서 청킹
→ embedding / Vector DB
→ hierarchy 분석
→ 문서 기반 QA 생성
→ RAG 기반 평가
```

하지만 내부망 환경에서는 다음 제약이 있을 수 있다.

- Vector DB 사용이 어렵거나 승인 절차가 길 수 있음
- Supabase 같은 외부 DB 사용 불가
- 데이터가 문서가 아니라 실사용자 발화 로그일 수 있음
- 컨텍스트가 문서 청크가 아니라 내부 지식, 청구 내역, 사용량, 가입상품 등 동적 데이터일 수 있음
- 모델 응답 로그는 정답이 아니라 참고 응답일 수 있음
- 고객 식별자 등 민감 정보가 포함될 수 있음

따라서 기존 프로덕션을 직접 변형하기보다, **내부 QA셋 생성용 별도 모드/별도 프로젝트**로 기획한다.

---

## 2. 목표

내부 QA셋 생성 프로젝트의 목표:

- CSV/XLSX 실발화 로그를 입력으로 받는다
- DB 없이 JSON/JSONL 파일 기반으로 동작한다
- 이미 라우팅된 `subagent_id`를 gold label로 활용한다
- `model_response`는 정답이 아니라 참고 응답으로 취급한다
- 필요 시 내부 컨텍스트를 JSON 파일로 결합한다
- 라우팅, 의도, 답변 품질, 컨텍스트 사용 여부를 평가할 수 있는 테스트셋을 생성한다

비목표:

- 초기 버전에서 Vector DB를 필수로 두지 않는다
- 고객 식별자를 프롬프트에 넣지 않는다
- `model_response`를 자동으로 정답으로 간주하지 않는다
- 외부 SaaS DB 저장을 기본 전제로 하지 않는다

---

## 3. 입력 데이터 스키마

### 3.1 최소 입력

원천 CSV/XLSX 최소 컬럼:

```text
transaction_id
subagent_id
user_query
model_response
```

`transaction_id`는 원천 로그 추적용이다. QA 생성 프롬프트에는 넣지 않는다.

`cust_id`는 가능하면 받지 않는 방향을 권장한다. 필요하더라도 내부 정규화 단계에서 가명화하고 프롬프트에는 넣지 않는다.

### 3.2 권장 입력

가능하면 아래 컬럼을 추가한다.

```text
session_id
turn_index
timestamp
intent_id
context_type
context_ref
response_trust
human_feedback
reference_answer
```

컬럼 의미:

| 컬럼 | 용도 | 생성 프롬프트 포함 여부 |
| --- | --- | --- |
| `transaction_id` | 원천 추적 | 기본 제외 |
| `subagent_id` | 라우팅 gold label | 포함 가능 |
| `user_query` | 핵심 사용자 발화 | 포함 |
| `model_response` | 참고 응답/candidate answer | 선택 포함 |
| `context_type` | 필요한 컨텍스트 유형 | 포함 가능 |
| `context_ref` | 외부 JSON 컨텍스트 참조 | 프롬프트에는 값 자체보다 resolved context 포함 |
| `reference_answer` | 검수된 정답 | 있으면 포함 |
| `response_trust` | 응답 신뢰도 | 포함 가능 |

---

## 4. 내부 정규화 포맷

CSV/XLSX를 바로 생성기에 넣지 않고 `records.jsonl`로 정규화한다.

```json
{
  "record_id": "tx_20260629_0001",
  "utterance": "이번 달 요금 왜 이렇게 많이 나왔어?",
  "observed_response": "이번 달 요금은 부가서비스 이용료와 데이터 추가 사용량 때문에 증가했습니다.",
  "gold": {
    "subagent_id": "BLA",
    "intent_id": null
  },
  "context": {
    "required": "unknown",
    "type": null,
    "ref": null,
    "payload": null
  },
  "labels": {
    "response_trust": "unverified",
    "human_feedback": null
  },
  "source": {
    "transaction_id": "tx_20260629_0001"
  }
}
```

생성기에 전달할 때는 더 작은 item 형태로 변환한다.

```json
{
  "docId": "tx_20260629_0001",
  "hierarchy": ["KT 고객센터", "요금", "청구내역_문의"],
  "text": "사용자 발화: 이번 달 요금 왜 이렇게 많이 나왔어?\n참고 응답: 이번 달 요금은 부가서비스 이용료와 데이터 추가 사용량 때문에 증가했습니다.",
  "metadata": {
    "source_type": "utterance_log",
    "subagent_id": "BLA",
    "subagent_name": "요금",
    "response_trust": "unverified"
  }
}
```

주의:

- `model_response`는 정답이 아닐 수 있으므로 프롬프트에서 참고 응답이라고 명시한다
- `transaction_id`는 결과 메타데이터에만 남기고 프롬프트 본문에는 넣지 않는다
- 고객 식별 정보는 프롬프트에 넣지 않는다

---

## 5. KT 에이전트 코드

마스터 에이전트가 의도 분류 후 서브 에이전트로 라우팅하는 구조를 전제로 한다.

원천 데이터의 `subagent_id`는 아래 코드값을 gold label로 사용한다.

```text
M     마스터
MA    영화
CA    기기변경
KA    지식
CBA   챗봇
LCA   장기혜택쿠폰 / 장기고객
MBA   멤버십
CCA   일상대화
BLA   요금
RA    로밍
AOA   부가서비스
WA    유선
UA    유심
```

별도 매핑 파일:

```text
datasets/{dataset_id}/subagent_map.json
```

```json
{
  "M": "마스터",
  "MA": "영화",
  "CA": "기기변경",
  "KA": "지식",
  "CBA": "챗봇",
  "LCA": "장기혜택쿠폰 / 장기고객",
  "MBA": "멤버십",
  "CCA": "일상대화",
  "BLA": "요금",
  "RA": "로밍",
  "AOA": "부가서비스",
  "WA": "유선",
  "UA": "유심"
}
```

주의:

- `M`은 최종 처리 서브에이전트가 아니라 마스터 라우터일 수 있으므로 별도 분석 대상이다
- `CBA`가 범용 챗봇/기타 처리인지, 실제 독립 서브에이전트인지 원천 시스템 정의 확인 필요
- `LCA`는 코드명은 장기혜택쿠폰이지만 운영 의미는 장기고객 범주로 매핑한다
- 평가 시 `subagent_id` 원본 코드와 표시용 `subagent_name`을 분리한다

---

## 6. 컨텍스트 모델

발화 유형에 따라 컨텍스트 필요성이 다르다.

### 6.1 컨텍스트 없음

예:

```text
멤버십 등급 어디서 확인해?
```

평가 대상:

- 라우팅 정확도
- 의도 분류 정확도

### 6.2 정적 내부 지식 컨텍스트

예:

```text
5G 요금제 추천해줘
```

필요 컨텍스트:

- 요금제 목록
- 상품 조건
- 할인/결합 정책
- 멤버십 혜택 정책

### 6.3 사용자별 동적 컨텍스트

예:

```text
이번 달 요금 왜 이렇게 많이 나왔어?
```

필요 컨텍스트:

- 청구 내역
- 부가서비스 가입 내역
- 사용량
- 할인 내역
- 최근 변경 이력

### 6.4 정적 + 동적 혼합 컨텍스트

예:

```text
내 사용량 기준으로 요금제 바꾸면 뭐가 좋아?
```

필요 컨텍스트:

- 사용량 프로필
- 현재 요금제
- 요금제 카탈로그
- 할인/약정 조건

---

## 7. 파일 기반 저장 구조

내부망/DB 미사용 환경을 기본으로 한다.

```text
datasets/
  kt_agent_logs_20260629/
    manifest.json
    records.jsonl
    subagent_map.json
    contexts/
      plan_catalog_202606.json
      bill_tx_0001.json
      usage_profile_tx_0002.json
    generated/
      routing_tests.json
      answer_tests.json
      context_tests.json
    evaluation/
      routing_eval.json
      answer_eval.json
      context_eval.json
```

`manifest.json` 예시:

```json
{
  "dataset_id": "kt_agent_logs_20260629",
  "source_type": "utterance_log",
  "created_at": "2026-06-29T00:00:00",
  "schema_version": "utterance-v1",
  "record_count": 10000,
  "contains_customer_id": false,
  "storage_mode": "local_json"
}
```

---

## 8. 생성 가능한 테스트셋 유형

### 8.1 Routing Test

목적:

- 사용자 발화를 올바른 서브 에이전트로 라우팅하는지 평가

출력 예:

```json
{
  "q": "이번 달 요금 왜 이렇게 많이 나왔어?",
  "expected_agent": "BLA",
  "expected_agent_name": "요금",
  "source_record_id": "tx_20260629_0001"
}
```

### 8.2 Intent Test

목적:

- 같은 서브 에이전트 내부의 세부 의도 분류를 평가

예:

```text
BLA / 청구내역_분석
BLA / 납부방법_문의
BLA / 소액결제_문의
```

### 8.3 Answer Test

목적:

- 컨텍스트 기반 응답 품질 평가

출력 예:

```json
{
  "q": "이번 달 요금 왜 이렇게 많이 나왔어?",
  "expected_agent": "BLA",
  "expected_agent_name": "요금",
  "context_type": "billing_history",
  "reference_answer": null,
  "candidate_answer": "이번 달 요금은 부가서비스 이용료와 데이터 추가 사용량 때문에 증가했습니다.",
  "answer_trust": "unverified"
}
```

### 8.4 Context Use Test

목적:

- 모델이 필요한 내부 컨텍스트를 제대로 활용했는지 평가

평가 포인트:

- 요금/할인/사용량 수치 정확성
- 사용자별 조건 반영 여부
- 컨텍스트에 없는 혜택 생성 여부
- 개인정보 과다 노출 여부

### 8.5 Robustness / Paraphrase Test

목적:

- 같은 의도를 다양한 실발화 표현으로 바꿔도 라우팅과 답변이 안정적인지 평가

예:

```text
이번 달 요금 왜 많이 나왔어?
요금이 갑자기 오른 이유 알려줘
이번 청구서 금액이 이상한데 확인해줘
```

---

## 9. 평가 체계

문서 RAG 평가와 분리한다.

현재 외부 프로덕션 평가:

```text
syntax
stats
rag_triad
qa_quality
```

내부 발화셋 평가:

```text
syntax
distribution
routing_accuracy
intent_accuracy
context_usage
answer_reference_match
privacy_safety
```

평가 기준:

| 평가 | 조건 |
| --- | --- |
| `routing_accuracy` | predicted_agent == subagent_id |
| `intent_accuracy` | predicted_intent == intent_id |
| `context_usage` | 답변이 필요한 context field를 정확히 사용 |
| `answer_reference_match` | reference_answer가 있을 때만 평가 |
| `privacy_safety` | 고객 식별자/불필요한 민감 정보 노출 방지 |

---

## 10. 현재 AutoEval과의 관계

현재 프로덕션:

```text
Document RAG QA Generator
```

내부용 신규 구상:

```text
Agent Scenario Testset Generator
```

공유 가능한 것:

- Job manager 패턴
- 모델 호출 래퍼
- 결과 저장 JSON 구조 일부
- syntax/statistics 평가 일부
- 프론트 job polling UI 일부

분리해야 하는 것:

- 입력 파서
- 프롬프트
- 평가 레이어
- 컨텍스트 로더
- 저장소
- 개인정보 처리 규칙

---

## 11. MVP 구현 계획

### Phase 1 — CLI 기반 파일 파이프라인

신규 스크립트:

```text
backend/scripts/import_utterance_dataset.py
backend/scripts/profile_utterance_dataset.py
backend/scripts/generate_agent_tests.py
backend/scripts/evaluate_agent_tests.py
```

목표:

- CSV/XLSX → `records.jsonl`
- subagent 분포 리포트 생성
- routing test JSON 생성
- reference 없는 response는 `unverified`로 표시

### Phase 2 — 컨텍스트 번들 지원

추가:

```text
contexts/*.json
context_ref resolver
context_type별 template
```

목표:

- 요금제 추천
- 청구내역 분석
- 멤버십/혜택 안내
- 가입상품 기반 답변

### Phase 3 — API/UI 분리

신규 API 후보:

```text
POST /api/internal-datasets/import
GET  /api/internal-datasets/{dataset_id}/profile
POST /api/internal-datasets/{dataset_id}/generate
POST /api/internal-datasets/{dataset_id}/evaluate
```

초기에는 외부 프로덕션 UI에 섞지 않고, 별도 탭 또는 별도 내부 배포로 둔다.

---

## 12. 보안/개인정보 원칙

- `cust_id`는 기본 입력 스키마에서 제외 권장
- 필요 시 해시/가명화 후 `customer_ref`로 저장
- `transaction_id`는 추적용 메타데이터에만 저장
- 프롬프트 본문에는 고객 식별자와 transaction id를 넣지 않음
- 외부 API 사용 시 컨텍스트 반출 여부를 명시 승인
- 내부망 전용 배포에서는 local model 또는 내부 승인 모델 사용 가능성 검토

---

## 13. 결론

내부 QA셋 생성 프로젝트는 기존 문서 RAG 기반 AutoEval을 억지로 변형하기보다, 같은 코드베이스 안의 별도 파이프라인으로 두는 것이 적합하다.

핵심 구조:

```text
CSV/XLSX 실발화 로그
→ records.jsonl 정규화
→ subagent/intent/domain profile
→ context bundle 결합
→ routing/answer/context-use 테스트셋 생성
→ 내부 평가
→ JSON 결과 저장
```

초기 MVP는 Vector DB 없이 JSON/JSONL 파일 기반으로 충분히 구현 가능하다.

---

## 14. 실제 골든셋 파일 검토 결과

검토 파일:

```text
ref/서브에이전트 관련 지식 골든셋.xlsx
```

시트:

```text
가이드
dbset(내부용)
```

실데이터는 `dbset(내부용)` 시트에 있다.

컬럼:

```text
번호
의도분류
질문
답변
비고
```

요약:

| 항목 | 값 |
| --- | ---: |
| 전체 row | 305 |
| 질문 결측 | 0 |
| 답변 결측 | 0 |
| 질문 중복 | 0 |
| 고유 답변 | 237 |
| 중복 답변 | 68 |
| 비고 입력 | 1 |

의도분류 분포:

| 의도분류 | 건수 | subagent_id | subagent_name |
| --- | ---: | --- | --- |
| 기변 | 212 | `CA` | 기기변경 |
| 멤버십 | 51 | `MBA` | 멤버십 |
| 장기고객 | 42 | `LCA` | 장기혜택쿠폰 / 장기고객 |

해석:

- 이 파일은 transaction log라기보다 라우팅/지식 응답용 골든 Q/A 세트에 가깝다
- `transaction_id`, `cust_id`, `session_id`는 없다
- `질문`은 사용자 발화 스타일이며, `답변`은 reference answer 후보로 볼 수 있다
- 같은 답변에 여러 질문이 연결된 paraphrase 구조가 많아 라우팅/의도 테스트셋으로 유용하다
- 가이드 시트에는 영화예매 등도 언급되지만 실제 `dbset(내부용)`에는 `기변`, `멤버십`, `장기고객`만 포함되어 있다

변환 기준:

| 원천 컬럼 | 내부 필드 | 비고 |
| --- | --- | --- |
| `번호` | `record_id`, `source.row_no` | `golden_row_0001` 형태 |
| `의도분류` | `gold.source_label` | 원천 라벨 보존 |
| `의도분류` | `gold.subagent_id` | `기변 → CA`, `멤버십 → MBA`, `장기고객 → LCA` |
| `질문` | `utterance` | 생성/평가 핵심 입력 |
| `답변` | `reference_answer` | 정답 후보. observed_response로 보지 않음 |
| `비고` | `source.note` 또는 `context.ref` | URL/출처가 있으면 분리 |

---

## 15. 샘플 JSON 구조

샘플 파일:

```text
docs/Samples/internal_qa_dataset_sample.json
```

샘플은 아래 구조를 한 파일에 묶어 보여준다.

```text
manifest
subagent_map
source_label_map
records
generation_items
generated.routing_tests
generated.answer_tests
generated.context_use_tests
evaluation_shape
```

운영 시에는 한 파일로 유지하기보다 아래처럼 분리 저장하는 것을 권장한다.

```text
datasets/{dataset_id}/
  manifest.json
  subagent_map.json
  records.jsonl
  generated/
    routing_tests.json
    answer_tests.json
    context_use_tests.json
  evaluation/
    routing_eval.json
    answer_eval.json
```

샘플 record:

```json
{
  "record_id": "golden_row_0001",
  "utterance": "지금 기기변경하면 위약금 발생하나요?",
  "observed_response": null,
  "reference_answer": "현재 사용 중인 약정에 따라 할인반환금이 발생할 수 있으니 남은 약정 기간을 확인해 보세요.",
  "gold": {
    "subagent_id": "CA",
    "subagent_name": "기기변경",
    "source_label": "기변",
    "intent_id": "penalty_check"
  },
  "context": {
    "required": "optional",
    "type": "contract_status",
    "ref": null,
    "payload": null
  },
  "labels": {
    "response_trust": "gold_candidate",
    "human_feedback": null
  },
  "source": {
    "row_no": 1,
    "transaction_id": null,
    "note": null
  }
}
```

샘플 routing test:

```json
{
  "test_id": "route_0001",
  "q": "지금 기기변경하면 위약금 발생하나요?",
  "expected_agent": "CA",
  "expected_agent_name": "기기변경",
  "source_record_id": "golden_row_0001"
}
```

샘플 answer test:

```json
{
  "test_id": "answer_0001",
  "q": "지금 기기변경하면 위약금 발생하나요?",
  "expected_agent": "CA",
  "expected_agent_name": "기기변경",
  "reference_answer": "현재 사용 중인 약정에 따라 할인반환금이 발생할 수 있으니 남은 약정 기간을 확인해 보세요.",
  "candidate_answer": null,
  "answer_trust": "gold_candidate",
  "source_record_id": "golden_row_0001"
}
```

주의:

- `transaction_id`가 있는 실로그에서는 원천 추적용으로만 저장하고 프롬프트 본문에는 넣지 않는다
- 이 골든셋에는 `transaction_id`가 없으므로 `번호` 기반 record id를 생성한다
- `답변`은 현재 파일 기준 `reference_answer` 후보로 취급한다
- 실로그에서 들어오는 `model_response`는 `observed_response`로 저장하고, 검수되지 않았다면 `reference_answer`로 승격하지 않는다
