# 🚀 Project Implementation Plan (2026-03-12)

이 문서는 Supabase Vector DB 통합, Hierarchy 기반 필터링, 그리고 UI/UX 개선을 위한 통합 실행 계획을 정의합니다.

---

## 🏗️ Phase 1: Vector DB & Data Ingestion (Backend)

현재의 JSON 기반 정적 데이터를 Supabase Vector DB(`pgvector`)로 전환하여 대용량 문서 처리 및 유사도 검색을 지원합니다.

### 1.1 Supabase Schema 설정
- `pgvector` 확장 활성화.
- `doc_chunks` 테이블 생성:
  - `id`: uuid (PK)
  - `content`: text (문서 청크 내용)
  - `metadata`: jsonb (파일명, 페이지, hierarchy 정보 등)
  - `embedding`: vector(3072) -- **Gemini Embedding 2** 기준
- `HNSW` 인덱스 생성으로 검색 성능 최적화.

### 1.2 Data Ingestion Pipeline (`ingestion_api.py`) [NEW]
- **File Support**: PDF, DOCS, Markdown 지원.
- **Embedding Model**: **Gemini Embedding 2** (`text-multimodal-embedding-002`) 활용.
  - 네이티브 멀티모달 지원 (텍스트, 이미지, PDF 직접 처리 가능).
  - 8192 토큰 컨텍스트.
- **Logic**:
  - `RecursiveCharacterTextSplitter`로 의미 단위 청킹.
  - 각 청크에 대해 임베딩 생성 및 Supabase 저장.

---

## 📂 Phase 2: Hierarchy 기반 필터링 & 샘플링

대량의 문서 중 특정 카테고리의 문서만 선택하여 QA를 생성하고, 중복 생성을 방지합니다.

### 2.1 API 연동 (`generation_api.py` [MODIFY])
- `hierarchy_filter` (Level 1, 2, 3) 파라미터 추가.
- **Stratified Sampling (균형 샘플링)**:
  - 선택된 범위 내에서 하위 카테고리별로 고르게 문서를 추출.
  - **중복 제외**: Supabase 기록을 조회하여 이미 QA가 생성된 문서는 우선 제외.

### 2.2 Hierarchy 데이터 관리
- `GET /api/hierarchy`: UI 구성을 위한 전체 계층 구조 반환.
- `GET /api/hierarchy/usage`: 각 계층별 문서 소진 현황(전체/미사용) 반환.

---

## 🎨 Phase 3: Frontend & UI/UX 개선

사용자가 문서를 쉽게 탐색하고, 프리미엄한 디자인 경험을 느낄 수 있도록 UI를 개편합니다.

### 3.1 Hierarchy Navigator [NEW]
- **Searchable Sidebar**: 100개가 넘는 Level 3 카테고리를 검색하고 멀티 선택할 수 있는 탐색기.
- **Real-time Badges**: "미사용 12 / 전체 48"과 같은 상태를 실시간 표시.

### 3.2 UI Aesthetic Theme 적용
- **Option A: Glassmorphism (Default)**: 반투명 유리 질감, `backdrop-blur`, 부드러운 그라데이션.
- **Option B: Neo Brutalism**: 강한 테두리, 높은 대비, 굵은 폰트 중심의 힙한 도구 느낌.
- 유저 선택 또는 단계별 적용 검토.

---

## 🧪 Phase 4: Verification & Test

1. **Unit Test**: PDF 추출 및 Gemini 임베딩 생성 정확도 검증.
2. **Search Test**: 특정 키워드/계층 검색 시 관련 청크 반환 여부 확인.
3. **E2E Test**: 파일 업로드 -> 벡터 저장 -> 계층 필터링 -> QA 생성 -> 평가 및 저장 전과정 확인.

---

## 📅 타임라인 (예상)
- **Day 1**: Phase 1 (Vector DB 셋업 & Ingestion API 기초)
- **Day 2**: Phase 2 (백엔드 필터링 & 샘플링 로직 완성)
- **Day 3-4**: Phase 3 (프론트엔드 네비게이터 및 테마 적용)
- **Day 5**: 최종 검증 및 배포 준비
