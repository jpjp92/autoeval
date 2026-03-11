# 🎯 AutoEval: QA 생성 및 평가 시스템

**1,106개 KT 고객지원 샘플데이터를 활용하여 QA 자동 생성 및 DeepEval/LLM-as-a-Judge 이중 평가 프로젝트**

---

## 📋 목차

1. [프로젝트 개요](#-프로젝트-개요)
2. [핵심 발견](#-핵심-발견)
3. [디렉토리 구조](#-디렉토리-구조)
4. [사용 방법](#-사용-방법)
5. [모델 비교](#-모델-비교)
6. [평가 방법론](#-평가-방법론)
7. [주요 파일 설명](#-주요-파일-설명)
8. [실행 흐름](#-실행-흐름)

---

## 🎯 프로젝트 개요

### 목표
KT 통신사 고객지원 웹사이트의 1,106개 문서로부터 **자동으로 고품질 QA 데이터셋을 생성**하고, **DeepEval 및 LLM-as-a-Judge를 통해 이중 검증**

### 핵심 요구사항
- **모든 QA는 제공된 컨텍스트만을 기반** (근거성/Groundedness 필수)
- **8가지 의도 유형 균형 커버**: factoid, numeric, procedure, why, how, definition, list, boolean
- **문서당 8개 질문** 생성으로 총 8,848개 QA 목표 (1,106개 문서 × 8)
- **비용 최적화 + 품질 보증**

---

## 💎 핵심 발견

### 최적 모델 선택 (1,106개 기준)

| 순위 | 모델 | 언어 | 비용 | 품질 | 의도 커버 | 추천 |
|------|------|------|------|------|----------|------|
| 🥇 | **Gemini 3.1 Flash-Lite** | EN | **$1.19** | 4.92/5 | ✅ 8/8 | ⭐⭐⭐⭐⭐ BEST |
| 🥈 | Gemini 3.1 Flash-Lite | KO | $1.35 | 4.92/5 | ✅ 8/8 | ⭐⭐⭐⭐ |
| 🥉 | Gemini 2.5 Pro | EN | $3.74 | 4.90/5 | ✅ 8/8 | ⭐⭐⭐ |
| | GPT-5.1 | EN | $8.17 | 4.94/5 | ✅ 8/8 | ⭐⭐⭐ Stable |
| | Claude Sonnet 4.5 | EN | $18.44 | 4.88/5 | ⚠️ 불균형 | ❌ PASS |

**🎯 최종 선택:** `Gemini 3.1 Flash-Lite (EN)` - 최저가 + 최고 성능

---

## 📁 디렉토리 구조

```
autoeval/
├── main.py                          # 통합 QA 생성 스크립트 (메인)
│
├── test/                            # 테스트 스크립트 모음
│   ├── test_gen1-1.py               # Claude Sonnet (KO)
│   ├── test_gen1-2.py               # Claude Sonnet (EN)
│   ├── test_gen2-1.py               # Gemini 2.5 Pro (KO)
│   ├── test_gen2-2.py               # Gemini 2.5 Pro (EN)
│   ├── test_gen3-1.py               # GPT-5.1 (KO)
│   ├── test_gen3-2.py               # GPT-5.1 (EN)
│   ├── test_gen4-1.py               # Gemini 3.1 Flash-Lite (KO)
│   ├── test_gen4-2.py               # Gemini 3.1 Flash-Lite (EN)
│   ├── test_gen5-1.py               # Gemini 3.1 Pro Preview (KO)
│   ├── test_gen5-2.py               # Gemini 3.1 Pro Preview (EN)
│   ├── test_gen6-1.py               # Claude Haiku (KO)
│   └── test_gen6-2.py               # Claude Haiku (EN)
│
├── data_check/                      # 데이터 검증 및 분석
│   ├── normalize_data.py            # 데이터 정규화
│   ├── quality_eval.py              # 휴리스틱 기반 품질 평가
│   ├── analyze_flash_lite.py        # Flash-Lite 분석
│   ├── analyze_pro_preview.py       # Pro Preview 분석
│   ├── analyze_haiku.py             # Haiku 분석
│   └── analyze_haiku_corrected.py   # Haiku 재분석 (가격 수정)
│
├── docs/                            # 문서 및 분석 보고서
│   ├── comparison.md                # 📊 전체 모델 비교 분석 (메인 리포트)
│   ├── sampletest.md                # 📋 DeepEval 테스트 계획
│   ├── pipeline-plan.md             # 🔄 전체 파이프라인 계획
│   ├── plan.md
│   ├── verifyplan.md
│   ├── ref.md
│   └── README.md                    # 문서 개요
│
├── output/                          # 생성된 QA 결과
│   ├── test3/                       # 모델 비교 테스트 결과 (12개 파일)
│   │   ├── test_gen1-1_*.json       # Claude Sonnet KO
│   │   ├── test_gen1-2_*.json       # Claude Sonnet EN
│   │   ├── test_gen2-1_*.json       # Gemini Pro KO
│   │   ├── ... (계속)
│   │   └── test_gen6-2_*.json       # Haiku EN
│   │
│   └── qa_*.json                    # main.py 생성 결과 (최종 데이터셋)
│       └── qa_flashlite_en_v2_20260309_155453.json
│
├── ref/                             # 참고 데이터 및 카테고리
│   ├── category.csv
│   ├── hierarchy.csv
│   ├── Shop.md, 고객지원.md, 상품.md, 혜택.md
│   └── data/
│       ├── data_2026-03-06_normalized.json  # 정규화된 1,106개 문서
│       └── formatted_results/, preprocessed_results/, scraped_results/
│
├── dashboard_sample/                # 대시보드 샘플
│   └── index.html
│
├── pyproject.toml                   # Python 환경 설정 (uv)
└── .env                             # API 키 설정 (git ignore)
```

---

## 🚀 사용 방법

### 1️⃣ 환경 설정

```bash
# uv 설치 (Python 패키지 관리자)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 의존성 설치
cd /home/jpjp92/devs/works/autoeval
uv sync

# .env 파일에 API 키 설정
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
OPENAI_API_KEY=sk-...
```

### 2️⃣ QA 생성 (메인 방식)

```bash
# 기본 (Flash-Lite EN, 20개 샘플)
uv run main.py

# 모델/언어/샘플 수 지정
uv run main.py --model flashlite --lang en --samples 100
uv run main.py --model gpt-5.1 --lang ko --samples 50
uv run main.py --model claude-sonnet --lang en --samples 30

# 지원 모델
#  flashlite (추천 ⭐)
#  gpt-5.1
#  gemini-pro
#  claude-sonnet
#  claude-haiku

# 언어 옵션: ko (한국어), en (영어)
# 프롬프트 버전: v2 (기본, 권장)
```

**출력:**
```
output/qa_{model}_{lang}_{version}_{timestamp}.json
예: output/qa_flashlite_en_v2_20260309_155453.json
```

### 3️⃣ 비교 테스트 (모델 검증)

```bash
# test 폴더의 스크립트 실행
cd test/
python test_gen4-2.py      # Flash-Lite EN (추천)
python test_gen3-2.py      # GPT-5.1 EN

# 또는 uv로 실행
uv run test_gen4-2.py
```

### 4️⃣ 데이터 정규화 및 분석

```bash
# 데이터 정규화
cd data_check/
python normalize_data.py

# 품질 평가
python quality_eval.py

# 모델별 분석
python analyze_flash_lite.py
python analyze_pro_preview.py
```

---

## 📊 모델 비교

### 상세 분석: [docs/comparison.md](docs/comparison.md)

**주요 메트릭:**
- **토큰 사용량**: Flash-Lite < GPT-5.1 < Gemini Pro < Claude
- **의도 커버리지**: Flash-Lite, GPT-5.1 (8/8) > 나머지 (불균형)
- **자연성**: GPT-5.1 > Flash-Lite > Gemini > Claude
- **비용 효율성**: Flash-Lite (17배 저렴) >> 나머지

### 프롬프트 버전

| 버전 | 특징 | 상태 |
|------|------|------|
| **v2** | 8가지 의도 명시, 8개 질문 | ✅ 권장 |
| v1 | 기본 (의도 불균형) | ❌ 비추천 |

### 언어 전략

| 조합 | 프롬프트 | 응답 | 비용 | 품질 |
|------|---------|------|------|------|
| **EN** | 영어 | 한국어 | 💰 더 저렴 | ⭐⭐⭐⭐⭐ |
| KO | 한국어 | 한국어 | 💰 조금 비쌈 | ⭐⭐⭐⭐ |

**추천:** 영어 프롬프트 (영어가 상대적으로 간결→더 적은 토큰)

---

## 📈 평가 방법론

### 이중 평가 체계

#### 1️⃣ DeepEval (정성 평가) - 개별 QA 품질

```
메트릭: Faithfulness, Answer Relevancy, Correctness, 
        Completeness, Coherence, Harmfulness

비용: $2.50/200 QA
시간: ~63분
점수: 0-1 (높을수록 좋음)

목标: ≥ 0.85 (Flash-Lite), ≥ 0.90 (GPT-5.1)
```

#### 2️⃣ LLM-as-a-Judge (구조 평가) - 데이터셋 완성도

```
지표: Groundedness, Coverage, Intent Diversity, 
      Entity Distribution, Redundancy

비용: Automatic (API 불필요)
점수: 0-100 (높을수록 좋음)

목标: ≥ 70 (배포 가능)
```

### 의도 동적 분석

PASS 선행 연구 기반:
- 원본 데이터: 28.5/100 (불균형)
- 생성 후 목표: 61.5/100+ (균형잡힌 분포)

**의도별 목표:**
| 의도 | 목표 비율 | 현황 |
|------|---------|------|
| factoid | 12-14% | ✅ |
| numeric | 12-14% | ✅ |
| procedure | 12-14% | ✅ |
| why | 10-12% | ✅ |
| how | 10-12% | ✅ |
| definition | 10-12% | ✅ |
| list | 10-12% | ✅ |
| boolean | 10-12% | ✅ |

---

## 📄 주요 파일 설명

### 🔴 필수 문서

| 파일 | 설명 | 중요도 |
|------|------|--------|
| [docs/comparison.md](docs/comparison.md) | 전체 모델 비교 분석 (최신) | ⭐⭐⭐ |
| [docs/sampletest.md](docs/sampletest.md) | DeepEval 테스트 계획 | ⭐⭐ |
| [docs/pipeline-plan.md](docs/pipeline-plan.md) | 전체 파이프라인 계획 | ⭐⭐ |

### 🔵 스크립트

| 파일 | 용도 | 상태 |
|------|------|------|
| main.py | **최종 QA 생성** (메인 진입점) | ✅ 완완 |
| test/test_gen*.py | 모델 비교 테스트 | ✅ 완료 |
| data_check/*.py | 데이터 검증 및 분석 | ✅ 완료 |

---

## 🔄 실행 흐름

### 최종 1,106개 QA 생성 단계

```
Phase 1: 샘플 테스트
├─ main.py --samples 100 (Flash-Lite EN)
├─ 비용: ~$0.35, 시간: ~5분
└─ 결과: output/qa_flashlite_en_v2_*.json

Phase 2: DeepEval 평가 (선택)
├─ 평가: 200 QA의 정성도 측정
├─ 비용: ~$2.50, 시간: ~63분
└─ 결정: Flash-Lite 적합성 확인

Phase 3: 전체 1,106개 생성
├─ main.py --samples 1106 (Flash-Lite EN)
├─ 비용: ~$1.19, 시간: ~20분
└─ 결과: output/qa_flashlite_en_v2_20260309_*.json

Phase 4: LJudge 검증
├─ 평가: 의도 분포, 근거성, 중복도
├─ 비용: FREE
└─ 결정: ✅ 배포 또는 ⚠️ 개선 필요

완료: 8,848개 최종 QA 데이터셋 🎉
```

### 예상 비용 및 시간

| 단계 | Flash-Lite EN | GPT-5.1 EN |
|------|---------------|-----------|
| 샘플 (100) | $0.35 / 5분 | $0.74 / 5분 |
| DeepEval | $2.50 / 63분 | $2.50 / 63분 |
| 전체 (1,106) | **$1.19** / 20분 | **$8.17** / 20분 |
| **합계** | **$4.04** | **$11.41** |

---

## 🔧 트러블슈팅

### API 키 설정 에러
```bash
ModuleNotFoundError: No module named 'google.genai'

해결:
cd /home/jpjp92/devs/works/autoeval
uv sync
```

### 파일 경로 에러
```
FileNotFoundError: ref/data/data_2026-03-06_normalized.json

원인: 스크립트 위치에 따라 상대경로가 변함
해결:
- main.py: 프로젝트 루트에서 실행
- test/*: test 폴더에서 실행 (../ 사용)
- data_check/*: data_check 폴더에서 실행 (../ 사용)
```

### 토큰 부족 에러
```bash
# 문서당 토큰 상한 설정
main.py: text[:2000] (2000자 제한)
test/test_gen*.py: text[:2000]
```

---

## 📚 참고 자료

- [LLM-as-a-Judge 평가 프레임워크](docs/sampletest.md#-11-llm으로서의-심판-구조-평가)
- [의도 유형 정의](docs/comparison.md#-3-의도-유형-분석)
- [프롬프트 설계 철학](docs/sampletest.md#-2-평가-메트릭-상세-정의)
- [PASS 선행 연구](docs/sampletest.md#-11-llm으로서의-심판-구조-평가)

---

## 📝 라이선스 및 저작권

**프로젝트:** AutoEval KT QA Generation System  
**생성일:** 2026-03-09  
**최종 업데이트:** 2026-03-09

---

## ✅ 체크리스트

- [x] 모델 비교 분석 완료
- [x] 최적 모델 선택 (Flash-Lite EN)
- [x] 프롬프트 통일 (v2)
- [x] 통합 CLI 스크립트 작성
- [x] 평가 방법론 설계 (DeepEval + LJudge)
- [x] 비용 예측 완료
- [ ] Phase 1: 샘플 테스트 실행
- [ ] Phase 2: DeepEval 평가 (선택)
- [ ] Phase 3: 전체 1,106개 생성
- [ ] Phase 4: LJudge 검증

---

**🎯 다음 단계:** `uv run main.py --model flashlite --lang en --samples 100` 실행 후 Phase 2 (DeepEval) 진행
