# 🚀 Project Implementation Plan (2026-03-12)

이 문서는 사용자가 제안한 체계적인 워크플로우에 따라 데이터 규격화부터 최종 리포트 구성까지의 실행 계획을 정의합니다.

---

## 🛠️ Phase 1: 데이터 규격화 (Vector DB Integration)

모든 형태의 입력 데이터(PDF, DOCS, Markdown 등)를 정형화된 벡터 데이터로 변환하여 관리합니다.

### 1.1 Supabase Vector Schema 구축
- `pgvector` 확장 활성화 및 `doc_chunks` 테이블 생성.
- **Gemini Embedding 2** (3072차원)를 기준으로 벡터 필드 설정.
- 데이터의 출처, 메타데이터, 청크 내용을 포함하는 규격화된 스키마 정의.

### 1.2 Ingestion 파이프라인 (`ingestion_api.py`)
- 다양한 문서 포맷 지원 및 텍스트 추출.
- `RecursiveCharacterTextSplitter`를 이용한 논리적 청킹.
- Gemini Embedding 2를 통한 네이티브 멀티모달 임베딩 생성 및 저장.

---

## 📂 Phase 2: 데이터 기반 Hierarchy 구성

규격화된 데이터를 바탕으로 서비스의 계층 구조를 자동/수동으로 분류하고 관리합니다.

### 2.1 계층 구조 생성 및 매핑
- 저장된 문서의 메타데이터를 분석하여 Level 1~3의 계층 구조 자동 제안.
- 사용자가 직접 계층을 수정하거나 매핑할 수 있는 관리 기능 제공.

### 2.2 Hierarchy Navigator UI
- **Searchable Sidebar**: 수백 개의 카테고리를 직관적으로 탐색.
- **Real-time Stats**: 각 계층별 문서 보유량 및 사용 현황 실시간 모니터링.

---

## 🤖 Phase 3: 데이터 생성 및 평가 (QA Pipeline)

구성된 계층 구조와 정밀한 벡터 검색을 활용하여 고품질의 QA를 생성하고 평가합니다.

### 3.1 계층 기반 생성 로직
- 특정 Hierarchy 영역을 타겟팅한 QA 생성.
- **균형 샘플링**: 하위 카테고리별로 고르게 문서를 추출하여 커버리지 극대화.
- **중복 방지**: 기존 생성 이력과의 docId 매칭을 통한 반복 생성 방지.

### 3.2 UI Flow & Page Transition [NEW]
- **Auto-Navigation**: QA 생성이 완료되면 자동으로 **Evaluation 페이지**로 전환하여 결과를 즉시 확인할 수 있도록 UX 개선.
- **Contextual Linking**: 생성된 각 데이터가 어떤 계층(Hierarchy)에서 왔는지 평가 화면에서도 유지.

---

## 📊 Phase 4: 리포트 구성 & 시각화 (Reporting)

평가 결과를 정밀하게 분석하고 사용자에게 인사이트를 제공합니다.

### 4.1 Evaluation 리포트 상세
- **Visual Charts**: 계층별 품질 점수(Relevance, Groundedness 등)를 레이더 차트나 바 차트로 시각화.
- **Error Analysis**: 점수가 낮은 취약 계층을 자동으로 하이라이트하여 개선 가이드 제공.

### 4.2 통합 대시보드 (Final Step)
- 모든 파일과 계층의 데이터를 종합한 최종 통계 정리.
- 전체 데이터셋의 건강도(Health Score) 및 모델 성능 비교 집계.

---

## 🧪 Verification Plan
- **Standardization Check**: 다양한 파일이 동일한 벡터 규격으로 저장되는지 확인.
- **Hierarchy Mapping Check**: 문서가 올바른 카테고리에 분류되는지 검증.
- **QA & Eval Check**: 계층 필터가 적용된 상태에서 정상적으로 생성/평가되는지 확인.
- **Report Check**: 수집된 데이터가 논리적인 리포트로 변환되는지 확인.

---

## 📅 타임라인 (예상)
- **Day 1**: Phase 1 (Vector DB 셋업 & Ingestion API 기초)
- **Day 2**: Phase 2 (백엔드 필터링 & 샘플링 로직 완성)
- **Day 3-4**: Phase 3 (프론트엔드 네비게이터 및 테마 적용)
- **Day 5**: 최종 검증 및 배포 준비
