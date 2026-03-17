# 🔧 적응형 QA 생성 프롬프트 설계 계획

> 작성일: 2026-03-17
> 목적: 도메인 하드코딩된 통신사 프롬프트 → DB 컨텍스트 기반 범용 적응형 프롬프트로 전환

---

## 배경 및 문제 정의

### 현재 문제

```python
# config/prompts.py 현재
SYSTEM_PROMPT_KO_V1 = """당신은 통신사 고객지원 QA 데이터셋 생성 전문가입니다."""
```

- 시스템 프롬프트가 "통신사 고객지원" 도메인에 고정되어 있음
- 실제 처리 문서(AI 데이터 구축 가이드, 법령, 매뉴얼 등)와 완전히 불일치
- 유저 템플릿 예시도 USIM, eSIM 등 통신사 예시만 사용

### 유지해야 할 핵심 원칙

아래 원칙들은 도메인에 무관하게 QA 품질의 핵심이므로 **반드시 유지**:

| 원칙                 | 설명                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| 근거성(Groundedness) | 모든 답변은 제공된 컨텍스트 내 명시적 근거 필요                         |
| 관련성(Relevance)    | Q와 A가 주제적으로 직접 대응                                            |
| 원자성(Atomicity)    | 질문 하나 = 개념 하나                                                   |
| 의도 유형 8종        | factoid / numeric / procedure / why / how / definition / list / boolean |
| 컨텍스트 부족 처리   | 근거 없으면 대체 질문 생성, N/A 금지                                    |
| 한국어 출력          | 질문·답변 모두 한국어                                                  |

---

## 설계 방향: 2단계 분리 처리

기존 1-step 방식(컨텍스트 → 즉시 QA 생성)을 2-step으로 분리.

```
[1단계] 도메인 분석
    DB 청크 샘플 + metadata
        → LLM이 문서 도메인·용어·특성 파악
            → domain_profile (JSON) 반환

[2단계] 적응형 QA 생성
    domain_profile + 청크 컨텍스트
        → domain_profile 기반 system prompt 동적 구성
            → 핵심 원칙 포함한 QA 생성
```

### 왜 2단계인가?

| 항목          | 1단계 통합 방식                                              | 2단계 분리 방식                                          |
| ------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| 도메인 적합성 | 단일 프롬프트가 도메인을 추론하면서 동시에 생성 → 품질 저하 | 도메인 파악 후 집중해서 생성 → 품질 향상                |
| 재사용성      | 청크마다 도메인 재추론                                       | domain_profile을**한 번** 생성, 모든 청크에 재사용 |
| 비용          | 청크 수 × (도메인 추론 + 생성)                              | 도메인 추론 1회 + 청크 수 × 생성                        |
| 디버깅        | 도메인 오인식과 생성 오류 구분 불가                          | 각 단계 독립 검증 가능                                   |

---

# 1단계: 도메인 분석 (Domain Profiling)

### 입력

- `doc_chunks` 테이블에서 샘플 청크 (metadata + content 앞 500자)
- metadata: `hierarchy_l1`, `hierarchy_l2`, `chunk_type`, `section_path`, `keywords`
- 샘플 수: 최대 10개 (L1별로 1~2개씩 분산 샘플링)

### 분석 프롬프트 목표

LLM이 아래 항목을 파악:

1. **문서 도메인**: 어떤 분야의 문서인가 (e.g., AI 데이터 구축 가이드, 법령, 기술 매뉴얼)
2. **대상 독자**: 누가 읽는 문서인가 (e.g., 데이터 작업자, 공무원, 일반 소비자)
3. **핵심 주제 영역**: L1 계층 기반 주요 토픽 목록
4. **도메인 특이 용어**: 전문 용어 목록 (5~10개)
5. **chunk_type 분포**: 어떤 청크 유형이 주를 이루는가 (table/list/body/heading)
6. **QA 생성 전략 힌트**: 어떤 의도 유형이 이 문서에 적합한가

### 출력: domain_profile (JSON)

```json
{
  "domain": "AI 데이터 구축 가이드라인",
  "domain_short": "데이터 구축 가이드",
  "target_audience": "데이터 구축 작업자 및 프로젝트 담당자",
  "main_topics": ["품질 기준", "프로세스 관리", "유형별 구축 사례"],
  "key_terms": ["청크", "레이블링", "품질 오류", "데이터 공정", "계층 구조"],
  "chunk_type_dist": {"table": 3, "list": 6, "body": 1, "heading": 1},
  "intent_hints": {
    "table": ["numeric", "list", "boolean"],
    "list": ["procedure", "how", "list"],
    "body": ["factoid", "why", "definition"],
    "heading": "skip"
  },
  "tone": "기술 문서 (격식체, 객관적 설명 중심)"
}
```

### 구현 위치

```python
# backend/generation_api.py 또는 신규 backend/domain_profiler.py
async def analyze_domain(doc_chunks_sample: list[dict], model: str) -> dict:
    """
    1단계: DB 청크 샘플을 분석하여 domain_profile 반환
    - 청크 샘플링: L1별 분산, 최대 10개
    - 결과 캐시: 동일 job_id 내 재사용 (청크마다 재실행 불필요)
    """
```

---

## 2단계: 적응형 QA 생성 (Adaptive QA Generation)

### 시스템 프롬프트 동적 구성

```python
def build_system_prompt(domain_profile: dict, lang: str = "ko") -> str:
    """
    domain_profile을 바탕으로 도메인 특화 시스템 프롬프트 생성
    핵심 원칙(근거성/관련성/원자성/의도유형/컨텍스트부족처리/한국어)은 고정 포함
    """
    domain = domain_profile["domain"]
    audience = domain_profile["target_audience"]
    key_terms = ", ".join(domain_profile["key_terms"][:5])
    tone = domain_profile["tone"]

    return f"""당신은 {domain} 분야의 QA 데이터셋 생성 전문가입니다.
대상 독자는 {audience}이며, 주요 용어는 {key_terms} 등이 사용됩니다.
주어진 컨텍스트만을 근거로 실제 현장에서 물어볼 법한 질문과 답변을 생성하세요.
문체: {tone}

[핵심 원칙]
... (기존 원칙 1~7 동일) ...
"""
```

### 유저 템플릿 도메인 적응

```python
def build_user_template(domain_profile: dict, chunk_type: str, n_qa: int) -> str:
    """
    chunk_type에 따라 의도 유형 가중치를 조정한 유저 템플릿 반환
    """
    intent_hints = domain_profile["intent_hints"].get(chunk_type, {})
    key_terms = domain_profile["key_terms"]
    domain_short = domain_profile["domain_short"]
    # ... 템플릿 구성
```

### chunk_type별 QA 전략 (intent 가중치)

| chunk_type  | 권장 intent 유형              | 스킵                |
| ----------- | ----------------------------- | ------------------- |
| `table`   | numeric, list, boolean        | —                  |
| `list`    | procedure, how, list          | —                  |
| `body`    | factoid, why, definition, how | —                  |
| `heading` | —                            | **전량 skip** |

> 8종 의도 유형 정의는 변경하지 않음. chunk_type별로 **우선 적용할 유형을 권장**하는 방식.

### 유저 템플릿 예시 섹션 동적화

```python
# 기존: USIM, eSIM 등 통신사 예시 하드코딩
# 변경: domain_profile.key_terms 기반 예시 동적 생성

def generate_intent_examples(domain_profile: dict) -> str:
    terms = domain_profile["key_terms"]
    domain = domain_profile["domain_short"]
    t0, t1 = terms[0] if len(terms) > 0 else "항목", terms[1] if len(terms) > 1 else "기준"
    return f"""
- factoid: "{t0}란 무엇인가?", "{domain}의 특징은?"
- numeric: "{t0}의 최소 기준은?", "최대 몇 개까지 허용되나?"
- procedure: "{t0} 처리 절차는?", "{t1} 적용 방법은?"
- why: "왜 {t0}이 필요한가?" → 컨텍스트에서 명시된 이유 제시
- how: "어떻게 {t1}를 검증하나?", "어떻게 {t0}을 구성하나?"
- definition: "{t0}이란 무엇인가?", "{t1}의 정의는?"
- list: "{t0}의 유형을 모두 나열하세요", "{t1} 항목들은?"
- boolean: "{t0}은 필수인가?", "{t1}은 선택 사항인가?"
"""
```

---

## 구현 파일 및 변경 범위

### 신규 또는 변경 파일

| 파일                           | 변경 유형      | 내용                                                                        |
| ------------------------------ | -------------- | --------------------------------------------------------------------------- |
| `backend/config/prompts.py`  | **변경** | 하드코딩 제거 →`build_system_prompt()`, `build_user_template()` 함수화 |
| `backend/domain_profiler.py` | **신규** | `analyze_domain()`: 1단계 도메인 분석                                     |
| `backend/generation_api.py`  | **변경** | 2단계 흐름 통합, domain_profile 캐시 및 재사용                              |
| `backend/main.py`            | **변경** | `generate_qa()` — system prompt를 동적으로 수신                          |

### 변경하지 않는 것

- 8종 의도 유형 정의 (factoid~boolean)
- 근거성/관련성/원자성 원칙 텍스트
- 컨텍스트 부족 시 대체 질문 처리 로직
- 한국어 출력 강제 조항
- JSON 출력 포맷 (`qa_list[].q/a/intent/answerable`)

---

## 전체 흐름 (변경 후 As-To-Be)

```
POST /api/generate (job 시작)
    │
    ├─ [1단계] analyze_domain()                     ← 신규
    │       DB doc_chunks에서 L1별 분산 샘플 10개 조회
    │       LLM 호출 → domain_profile JSON 파싱
    │       job 내 캐시 저장 (청크마다 재실행 안 함)
    │
    └─ [2단계] 청크별 QA 생성 루프
            for chunk in filtered_chunks:
                if chunk_type == "heading": skip
                if is_colophon_chunk(content): skip
                system_prompt = build_system_prompt(domain_profile)
                user_template  = build_user_template(domain_profile, chunk_type)
                raw_text = strip_context_prefix(content)   ← 기존 크리티컬 수정
                generate_qa(raw_text, system_prompt, user_template)
```

---

## 단계별 구현 순서

### Phase A — 크리티컬 수정 (즉시, 독립적)

- [ ] `backend/main.py` — context prefix 제거 (`raw_text` 추출)
- [ ] `generation_api.py` — dummy zero vector → 직접 select 필터 교체
- [ ] `generation_api.py` — heading/발행처 청크 skip

### Phase B — 프롬프트 범용화 (이번 작업)

- [ ] `backend/domain_profiler.py` 신규 작성
  - `sample_chunks_for_profiling()`: L1별 분산 샘플링
  - `build_domain_analysis_prompt()`: 1단계 분석용 프롬프트
  - `analyze_domain()`: LLM 호출 + JSON 파싱 + 캐시
- [ ] `backend/config/prompts.py` 리팩토링
  - 상수 → 빌더 함수로 전환
  - `build_system_prompt(domain_profile, lang)`
  - `build_user_template(domain_profile, chunk_type, n_qa)`
  - `generate_intent_examples(domain_profile)`
  - 기존 상수는 deprecated 주석 처리 (fallback용 유지)
- [ ] `backend/generation_api.py` — 2단계 흐름 통합
  - job 시작 시 `analyze_domain()` 1회 호출
  - 각 청크 생성 시 캐시된 domain_profile 사용

### Phase C — 프론트엔드 연동

- [ ] `GET /api/ingestion/hierarchy-list` API 추가
- [ ] `QAGenerationPanel.tsx` — hierarchy 동적 드롭다운
- [ ] JSON fallback 제거

---

## domain_profile 캐시 전략

```python
# generation_api.py JobManager 내부
class GenerationJob:
    domain_profile: Optional[dict] = None   # 1단계 결과 캐시
    domain_profile_lock: Lock = Lock()      # 중복 실행 방지
```

- job 내 첫 번째 청크 처리 전 1회 실행
- 동일 job의 모든 청크가 동일 domain_profile 공유
- 추후: 동일 filename 재실행 시 DB 캐시 (선택적 개선)

---

## 리스크 및 대응

| 리스크                        | 가능성 | 대응                                           |
| ----------------------------- | ------ | ---------------------------------------------- |
| 1단계 LLM이 도메인 파악 실패  | 낮음   | fallback으로 범용 generic domain_profile 사용  |
| domain_profile JSON 파싱 오류 | 보통   | try/except → generic fallback                 |
| 1단계 API 비용 추가           | 낮음   | 샘플 10개 × ~1K tok = 미미한 비용, 캐시로 1회 |
| chunk_type 없는 청크          | 낮음   | None →`body` fallback                       |

### Generic Fallback domain_profile

```python
GENERIC_DOMAIN_PROFILE = {
    "domain": "문서",
    "domain_short": "문서",
    "target_audience": "독자",
    "main_topics": [],
    "key_terms": [],
    "chunk_type_dist": {},
    "intent_hints": {
        "table": ["numeric", "list", "boolean"],
        "list": ["procedure", "how", "list"],
        "body": ["factoid", "why", "definition"],
        "heading": "skip"
    },
    "tone": "격식체"
}
```

---

## 검증 계획

1. `analyze_domain()` 단독 테스트: 현재 DB 12개 청크로 domain_profile 생성 확인
2. `build_system_prompt()` 출력 확인: 도메인명/독자/용어가 올바르게 반영되는지
3. 청크 1개로 QA 생성 엔드투엔드 테스트: "AI 데이터 구축 가이드" 도메인으로 QA 생성 품질 확인
4. 기존 핵심 원칙 유지 확인: 근거성/의도유형 JSON 구조 동일한지 검증
