# 현재 모델 구성

2026-11-09 기준. 중앙 설정: `backend/config/models.py`.

| 용도 | Google | OpenAI |
| --- | --- | --- |
| QA 생성 | `gemini-3.8-flash` (기본) | `gpt-6-luna` |
| RAG Triad / QA Quality Judge | `gemini-3.7-flash` | `gpt-5.6-luna` (기본) |
| 청킹·태깅·계층·도메인 분석 | `gemini-2.5-flash` | 사용 안 함 |
| 임베딩 | `gemini-embedding-2`, 1536차원 유지 | 사용 안 함 |

Claude는 보류하여 생성·평가 선택지에서 제외한다. 기존 모델 registry는 과거 결과 및
명시적인 기존 API 요청의 호환을 위해 유지한다.

## 프론트 모델 선택

`frontend/src/lib/models.ts`에서 생성·Judge 목록과 기본값을 관리한다.
`ModelSelect.tsx`는 label·도움말이 연결된 커스텀 combobox/listbox를 사용한다.
트리거와 펼침 메뉴는 둥근 모서리와 은은한 테두리를 사용한다. 기본 선택지는 배지로 표시하고 생성·평가 진행 중에는 두 선택기를 비활성화한다.
모바일에서는 한 열로 배치한다. 선택한 value는 model / evaluator_model에 그대로 전달한다.
화면 모델 ID와 기본값이 백엔드 중앙 설정과 일치하는지 변경 시 함께 확인한다.

## 호출 호환성

- GPT Luna는 기존 Chat Completions 경로를 유지한다. 함수 호출은 사용하지 않는다.
- 비용·지연과 기존 출력 토큰 예산을 유지하도록 `reasoning_effort="none"`을 명시한다.
- Gemini 3.7/3.8 Judge는 sampling 옵션과 candidate_count를 요청에서 제외한다.
  현재 LangChain SDK는 생성자의 temperature=None을 허용하지 않으므로
  per-request generation_config에서 해당 필드를 None으로 덮어써 전송을 생략한다.
- Judge 응답은 LangChain AIMessage.text를 통해 추출한다. 문자열과 텍스트 블록 목록을
  모두 처리하고 reasoning 블록을 JSON 결과에 섞지 않는다.
- 문서 도메인 분석의 폴백도 QA 생성 모델 대신 2.5 Flash를 사용한다.
- 임베딩 모델과 벡터 차원은 변경하지 않는다. 기존 문서 재임베딩은 필요하지 않다.

## 비용 추정

표준 텍스트 요청의 USD / 1M 토큰 기준. 캐시·배치·긴 컨텍스트·지역별 요금은 별도다.

| 모델 | 입력 | 출력 |
| --- | ---: | ---: |
| Gemini 3.8 Flash | 0.75 | 3.75 |
| Gemini 3.7 Flash | 0.75 | 3.75 |
| GPT-6 Luna | 0.10 | 0.50 |
| GPT-5.6 Luna | 0.20 | 1.20 |

Gemini 요금은 2026-12-31까지의 도입 가격이므로 2027년 전에 갱신해야 한다.
QA 생성의 estimated_cost는 중앙 설정의 토큰당 단가를 사용한다.

## 공식 자료

- [Gemini 3.8 Flash / migration](https://ai.google.dev/gemini-api/docs/latest-model)
- [Gemini 3.7 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [GPT-6 Luna — OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GPT-5.6 Luna — OpenAI Docs](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI migration parameters](https://developers.openai.com/api/docs/guides/latest-model)
