# 문서 처리 모델 교체: Gemini 2.5 Flash → 3.5 Flash-Lite (2026-11-22)

## 배경
- Gemini API의 `gemini-2.5-flash` 종료 예정일이 2026-12-01이다. 종료 후 요청은 다른 모델로 자동 전환된다.
- 문서 처리(LLM 청킹, 계층 분류, 태깅, 도메인 프로파일)는 모두 2.5 Flash를 쓴다.

## 결정
- 문서 처리 모델을 `gemini-3.5-flash-lite`로 바꾼다.
  - 단가는 입력 $0.30, 출력 $2.50 (1M 토큰당)으로 2.5 Flash 정가와 같다. 제3자 정리 기준이며 공식 페이지에서 다시 확인해야 한다.
- 3.6 Flash는 1월 정가 기준으로 비용이 약 3.3배라 이번에는 제외한다.
- GPT-6 Luna($0.10 / $0.50)는 측정 스크립트로 따로 품질을 비교한다. 서비스 코드에는 넣지 않는다.

## 변경
1. `config/models.py`
   - `gemini-3.5-flash-lite` 항목을 추가하고 `DOCUMENT_MODEL`을 이 항목으로 바꾼다.
   - `DOCUMENT_MODEL_ID` 환경변수로 model_id를 덮어쓸 수 있게 한다. 모델이 갑자기 종료돼도 재배포 없이 바꾸기 위해서다.
   - 기존 `gemini-flash`(2.5) 항목은 남겨 두고, 지난 결과의 비용 표시를 위해 단가만 정가로 고친다.
2. `MODEL_CONFIG["gemini-flash"]`를 직접 쓰던 곳(ingestion_api 청킹·태깅, llm_chunker 기본값)을 `DOCUMENT_MODEL`로 바꾼다.
3. 3.x는 `thinking_budget=0`을 받지 않아(400) `no_thinking_config(model_id)`로 2.x는 budget=0, 3.x는 `thinking_level="minimal"`을 쓴다.
4. 측정 스크립트(scratchpad): 같은 문서를 3.5 Flash-Lite, 2.5 Flash, GPT-6 Luna로 청킹해 비교한다.
   - 비교 항목: 시간, 실제 토큰 사용량과 비용, JSON 실패, 청크 수, 원문 대비 글자 보존율.

5. (추가) 청킹 설정에 seed를 고정한다(청크 수 흔들림). 도메인 프로파일에도 thinking 최소화를 적용한다.
6. (추가) 쓰지 않는 `.env.example` 모델 변수를 지운다.

## 손대지 않는 것
- DB 스키마, 임베딩 모델, 이미 처리된 문서(다시 처리하지 않는다).
- QA 생성(3.8 Flash)과 평가(GPT-5.6 Luna).
