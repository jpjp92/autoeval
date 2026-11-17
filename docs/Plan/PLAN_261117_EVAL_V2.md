# 평가 파이프라인 v2 기획 (2026-11-17)

> 상태: 1~4, 6단계 완료, 7단계 대부분 완료(2026-11-17). 5단계(비교·골든셋), 7단계 대시보드, 8단계(기본값 전환)가 남았다. 결과는 [DEV_261117.md](../History/DEV_261117.md)의 "평가 v2" 절.
> 입력: 자체 검토 + GPT 검토 2건(파이프라인 재설계, 다국어 평가, 같은 날). 방향이 같아 하나로 합쳤다.
> 범위: `backend/evaluators/`, 평가 API, 평가 화면. DB 스키마는 바꾸지 않는다. 버전과 새 지표는 기존 JSON 칸(`metadata`, `scores`, `pipeline_results`)에 넣는다.

## 1. 현재 구조와 확인된 문제

최종 점수 = 구문 통과율 ×0.05 + 통계 ×0.05 + RAG Triad ×0.65 + 완전성 ×0.25 (`pipeline.py` `run_evaluation`)

| # | 문제 | 근거 (코드 확인) |
| --- | --- | --- |
| P1 | **통계 항이 항상 상수다.** `pipeline.py`가 `stats_data.get("integrated_score", 5)`를 읽는데 `DatasetStats.analyze_all()`은 이 키를 반환하지 않는다. 통계 결과와 관계없이 항상 5/10, 즉 0.025점이다. | `dataset_stats.py` 반환 키: `stats`, `metrics`, `diversity`, … |
| P2 | **평가 실패가 중간 점수로 섞인다.** Judge 호출·파싱이 실패하면 0.65(완전성은 0.5)로 대체한다. 실패 표시(`error`)가 결과에 남지 않는 경로도 있다(`evaluate_all_with_reasons` 내부 예외). | `rag_triad.py`, `qa_quality.py`, `_rag_worker`, `_quality_worker` |
| P3 | 구문 통과율이 점수에 5% 들어간다. 탈락 QA는 이미 평가에서 빠지므로 거의 항상 100%다. | `run_full_evaluation_pipeline` Layer 1-A |
| P4 | 통계 지표가 목적에 맞지 않는다. Sufficiency(필드 채움률)는 구문 검사와 중복이다. Skewness는 문서 하나로 만든 QA를 100% 집중으로 보고 2/10을 준다. TTR은 한국어에서 신뢰도가 낮다. | `dataset_stats.py` |
| P5 | context_relevance는 질문을 만든 원문을 컨텍스트로 쓰므로 거의 항상 높다. 실제 검색 성능 지표로 해석하면 안 된다. | `rag_triad.py` |
| P6 | relevance(모든 측면에 답했는가)와 completeness(하위 질문 커버리지)가 겹친다. QA당 Judge 호출이 2회다. | `rag_triad.py`, `qa_quality.py` |
| P7 | 가중 평균이라 근거 없는 답이 몇 개 섞여도 등급에 묻힌다. | `run_evaluation` |

## 2. v2 구조: Data Validation → Unified LLM Judge

### 2-1. Stage 1 — Data Validation (결정론적, 점수 아님)

| 검사 | 처리 |
| --- | --- |
| 필수 필드·타입, 질문·답변 길이 | Hard Fail. 평가에서 제외하고 사유를 보고한다 (기존 `SyntaxValidator`) |
| 필드 채움률(Sufficiency) | 구문 결과로 대체. 따로 계산하지 않는다 |
| 동일·유사 질문 | 중복 의심으로 표시한다. 1단계에서는 제외하지 않는다 |
| intent 분포, 문서별 QA 수 | 정보성 통계 |
| 문서 집중도(Skewness) | 문서가 2개 이상일 때만 경고. 문서 하나면 표시하지 않는다 |
| 어휘 다양도(TTR) | 참고값으로만 표시 |

결과는 `pipeline_results.validation`에 넣는다: `total`, `valid`, `invalid`, `errors_sample`, `duplicates`, `intent_distribution`, `doc_distribution`, `warnings`.

### 2-2. Stage 2 — Unified LLM Judge (QA당 1회 호출)

| 지표 | 평가 질문 | 비고 |
| --- | --- | --- |
| groundedness | 답변의 주장이 원문에 근거하는가 | 기존 RULE 1~4(직접 근거, 계산값, 추세 표현, 근거 없음) 유지. 주장별 판정(`evidence`)을 함께 받는다 |
| correctness | 수치·단위·날짜·조건(표의 행·열 포함)이 원문과 일치하는가 | 신규. 표 청크 개선으로 수치 QA가 늘어나므로 따로 본다 |
| completeness | 질문이 요구한 항목에 모두 답했는가 | relevance를 흡수한다. 엉뚱한 답은 여기서 0점 |
| question_quality | 질문이 명확하고, 원문만으로 답할 수 있고, "이 문서에서" 같은 지시어 없이 혼자 읽히는가 | context_relevance 대체 |

응답 형식 (점수는 0~10 정수, 파싱 후 0~1로 바꾼다):

```json
{
  "groundedness": 9, "correctness": 10, "completeness": 8, "question_quality": 9,
  "evidence": [{"claim": "...", "source": "원문 인용", "verdict": "supported|unsupported|contradicted"}],
  "failure_types": ["numeric_error"],
  "reason": "한국어 한 문장"
}
```

- `failure_types` 값: `unsupported_claim`, `numeric_error`, `incomplete`, `unanswerable_question`, `ambiguous_question`.
- 이유 문장은 화면 언어 기준으로 한국어다. 근거 인용(`evidence.source`)은 원문 언어 그대로 둔다.
- Judge 실패(호출 예외, JSON 파싱 실패, 점수 누락)는 `evaluation_error`로 기록하고 점수·통과율 계산에서 뺀다. 중간 점수로 대체하지 않는다. 한도 초과(429)는 지금처럼 작업 전체를 멈춘다.

### 2-2a. 언어 정책 (Language-Aware Judge)

점수 체계와 기준값은 언어와 관계없이 하나다. 한국어 0.95와 영어 0.95는 같은 품질이어야 모델 비교가 된다. 언어별로 달라지는 것은 Judge 프롬프트에 붙는 검사 규칙(`<language_policy>`)뿐이다.

| 원문 → QA | 정책 | 중점 검사 |
| --- | --- | --- |
| ko → ko | `korean_native` | 부정·이중부정, 조건문, 적용 대상과 예외(다만·제외), 조사·수식 범위, 수치·용어 보존 |
| en → en | `english_native` | 전문용어·약어, modality(may/must), 부정·예외, 수식·수치·통계적 유의성 |
| en → ko | `cross_language_en_to_ko` | 의미 동등성, % vs %p, 가능성→확정 변환, 부정 반전, 용어 번역 일관성 |
| ko → en | `cross_language_ko_to_en` | 의미 동등성, 조건·예외 보존, 고유명사 표기, 만/억 환산, 부정·modality |

- **언어 결정:** 원문 언어와 QA 언어를 따로 정한다(`resolve_languages`).
  - 원문 언어는 QA에 `source_language`(청크 metadata)가 있으면 그 값을 쓴다. 없으면 컨텍스트로 판별(`detect_language`, 200자 기준)하고 `source_language_from = "inferred"`로 기록한다. 현재 생성 결과에는 이 값이 없어서 모두 판별값이다.
  - QA 언어는 생성 설정 `lang`을 쓴다. 없으면 질문·답변으로 판별한다. 짧은 텍스트용 기준(라틴 10자 이상, 한글 비율 < 0.05)을 쓴다.
  - 생성 설정 `lang`은 QA 출력 언어다. 원문 언어로 쓰지 않는다.
- **세부 실패 유형:** `meaning_shift`, `modality_mismatch`, `negation_error`, `unit_mismatch`, `terminology_error`, `condition_omitted`.
- **중복 감점 방지:** 언어 검사는 4개 지표의 판정 근거로만 쓴다. `language_checks`(semantic_equivalence, terminology_consistency, numeric_consistency, modality_preserved)는 진단 필드이고, 점수에 따로 들어가지 않는다.
- **집계:** 요약에 정책별 판정 수, 통과율, 평균 QA 점수(`by_language_policy`)를 넣는다.
- **혼합 언어 문서(`mixed`):** 1차 범위 밖이다. 판별 결과는 ko 또는 en 하나다.
- 실측 결과는 DEV_261117 "평가 v2" 절. 교차 언어 오류 4종과 조건 누락 1건을 모두 맞는 유형으로 잡았다.

### 2-3. 점수와 등급

- **QA 점수** = groundedness ×0.35 + correctness ×0.30 + completeness ×0.20 + question_quality ×0.15. 초기값이며 4장 비교 후 보정한다.
- **Hard Fail**(가중 평균보다 우선): groundedness < 0.6 또는 correctness < 0.6이거나, `evidence`에 `contradicted`가 있으면 그 QA는 불통과.
- **QA 통과** = Hard Fail 아님 + QA 점수 ≥ 0.70 + question_quality ≥ 0.5. 마지막 조건은 실측에서 추가했다: "위 표에서 …" 같은 지시어 질문이 question_quality 0.2인데도 가중치 15%라 0.88로 통과했다. 감점 배율은 적용하지 않는다.
- **최종 점수** = 평가된 QA의 QA 점수 평균. 단 Hard Fail QA는 QA 점수를 0.5배로 넣는다.
- 등급 구간(A+ ≥0.95, A ≥0.85, B+ ≥0.75, B ≥0.65, C ≥0.50)은 그대로 쓴다.
- 평가 실패 QA가 20%를 넘으면 등급을 매기지 않는다(`grade = null`, 사유 표시).

### 2-4. 버전과 호환

- `metadata.eval_version = "v2"`. 값이 없는 기존 결과는 v1이다. 기존 결과는 다시 계산하지 않는다.
- v1 경로는 그대로 둔다. P1(통계 항 상수)도 v1에서는 고치지 않는다. 고치면 v1 이력끼리도 점수가 어긋나기 때문이다. v1의 통계 항이 사실상 상수였다는 점은 기록으로만 남긴다.
- v1 P2(실패 대체)는 점수를 바꾸지 않고, 실패 표시와 실패 건수만 결과에 남긴다.
- v2 결과도 기존 화면이 깨지지 않도록 `summary.final_score`, `summary.grade`, `qa_preview[].pass`, `qa_preview[].groundedness`, `completeness` 같은 기존 키를 채운다.
- 대시보드 점수 추이와 모델 비교는 같은 버전끼리만 묶는다.

### 2-5. UI (2단계 화면)

> 화면별 상세(QA Pipeline, Evaluation, 리포트 HTML·xlsx, Dashboard)는 [PLAN_261117_EVAL_V2_UI.md](PLAN_261117_EVAL_V2_UI.md)에 있다. 아래는 요약이다.

- 상단: 전체 QA, 품질 통과 수, 통과율, 등급, 평가 실패 수.
- **데이터 검증** 카드: 구문 정상 n/n, 중복 의심 n건, 경고. 분포 차트는 상세 보기로 접는다.
- **AI 품질 평가** 카드: 지표 4개 평균, Hard Fail 수, QA별 결과와 실패 사유·근거.
- v1 결과를 열면 기존 화면을 그대로 보여 준다(버전으로 분기).
- 내보내기(HTML·JSON)와 이력은 두 버전 모두 동작해야 한다.

## 3. 작업 단계

| 단계 | 작업 | 파일 | 상태 |
| --- | --- | --- | --- |
| 1 | v1 평가 실패 표시와 건수 집계 (점수 불변) | `rag_triad.py`, `qa_quality.py`, `pipeline.py` | 완료 |
| 2 | Data Validation 모듈 | `evaluators/data_validation.py` (신규) | 완료 |
| 3 | v2 Judge 프롬프트·파서·점수 계산 | `evaluators/qa_judge.py` (신규) | 완료 |
| 4 | 파이프라인 v2 경로 (아직 API 미연결) | `evaluators/pipeline_v2.py` (신규) | 완료 |
| 4a | 언어 정책 4종, 언어 결정, 정책별 집계 | `qa_judge.py`, `pipeline_v2.py` | 완료 |
| 5 | v1/v2 비교 스크립트 + 골든셋 | `backend/scripts/compare_eval.py` (DB 쓰기 없음) | |
| 6 | API에 `eval_version` 선택 추가, v2 저장 | `api/evaluation_api.py`, `pipeline.py` `_run_v2` | 완료 |
| 7 | 평가 화면 v2 분기, 대시보드 버전 구분, 내보내기 | [PLAN_261117_EVAL_V2_UI.md](PLAN_261117_EVAL_V2_UI.md) | 대시보드 외 완료 |
| 8 | 가중치·기준 보정 후 기본값 v2 전환 | | |

## 4. 검증

- **단위 테스트** (LLM mock): Judge 응답 파싱(정상, 코드블록, 점수 누락, 범위 밖), Hard Fail 규칙, 평가 실패 제외, 등급 보류, Data Validation(중복, 단일 문서 집중도 무경고), v1 실패 표시.
- **골든셋**: ko→ko, en→en, en→ko, ko→en 시나리오별 10~15개. 정상, 일부 누락, 수치 오류, 근거 없는 답, 답할 수 없는 질문, 지시어 질문을 섞는다. 표 수치 QA를 포함한다. 사용자가 정답 라벨을 확인한다.
- **비교**: 같은 QA 세트에 v1(2회 호출)과 v2(1회 호출)를 돌려 사람 라벨 일치율, 실패 유형 분류, 호출 수·토큰·지연을 비교한다. 단일 호출에서 지표끼리 점수가 지나치게 붙으면(상관이 높으면) 2회 호출로 나누는 안을 검토한다.
- **회귀**: 이력 조회, 대시보드, 내보내기가 v1 결과에서 그대로 동작하는지 확인한다.

## 5. 결정이 필요한 것

| 항목 | 제안 기본값 |
| --- | --- |
| 지표 가중치 | 근거성 35 / 정확성 30 / 완전성 20 / 질문 품질 15 |
| Hard Fail 기준 | groundedness·correctness < 0.6, 또는 contradicted 주장 |
| QA 통과 기준 | QA 점수 ≥ 0.70, 질문 품질 ≥ 0.5 |
| 등급 보류 기준 | 평가 실패 20% 초과 |
| 중복 QA | 1단계는 표시만 |
| v1 유지 기간 | 기본값 전환 후 한 달 |
| 생성 결과에 `source_language` 저장 | 다음 생성부터 청크 값을 QA 결과에 함께 저장 (지금은 판별값) |

## 6. 제약

- 기존 API와 DB에 하위 호환. 스키마 변경 없음.
- 비교 결과 없이 기본값을 v2로 바꾸지 않는다.
- 커밋, 푸시, 배포는 사용자가 요청할 때만 한다.

## 7. 참고

- [Ragas 논문](https://arxiv.org/html/2309.15217v2), [Ragas 지표](https://docs.ragas.io/en/stable/references/metrics.html): 주장 단위 faithfulness, factual correctness
- [DeepEval](https://deepeval.com/docs/metrics-introduction): 핵심 지표 5개 이하, G-Eval rubric
- [RAGalyst](https://arxiv.org/html/2511.04502v1): 합성 QA 필터링, answerability 판정
- [문서 기반 합성 평가의 질문 근거성](https://arxiv.org/pdf/2505.08905), [RAG 답변 가능성](https://arxiv.org/pdf/2403.01461)
- [합성 vs 사람 RAG 벤치마크](https://arxiv.org/pdf/2508.11758v2), [STELLAR-E](https://arxiv.org/html/2604.24544v1): 판정 모델을 사람 라벨로 검증
