# 문서 안내

현재 구성 기준: 2026-11-09.

| 문서 | 내용 |
| --- | --- |
| [모델 구성](Guide/MODEL_CONFIGURATION.md) | 생성·Judge·문서 처리·임베딩 모델, UI 기본값, 공식 자료 |
| [프론트 흐름](Guide/REF_FRONTFLOW.md) | Next.js App Router, 탭 상태, 모델 선택과 API 전송 |
| [백엔드 흐름](Guide/REF_BACKFLOW.md) | API와 작업 처리 |
| [RAG](Guide/REF_RAG.md) | 인제스션·임베딩·검색 |
| [평가](Guide/REF_EVAL.md) | 평가 지표와 Judge 처리 |
| [프롬프트](Guide/REF_PROMPTS.md) | 단계별 프롬프트와 적용 모델 |
| [DB](Guide/REF_DB.md) | 저장 구조와 메타데이터 |
| [Docker 설치·실행](Guide/SETUP_DOCKER.md) | Ubuntu 설치 명령과 개발·운영 검증 |
| [Docker 구성](Guide/REF_DOCKERUSE.md) | 이미지, 포트, 볼륨, 환경변수 |
| [배포 가이드](Guide/REF_DEPLOYUSE.md) | Render + Vercel 설정 |
| [배포 요약](Guide/DEPLOY_CONFIG.md) | 프록시와 플랫폼 역할 |
| [프론트 보안](Guide/FRONTEND_SECURITY.md) | Next.js 패치 버전과 남은 audit 항목 |

`DEV_*.md`와 `History/`는 작성 당시의 변경·실험 기록이다.
현재 동작은 Guide 문서를 우선한다. `PLAN_*.md`는 미구현 설계를 포함하며,
각 문서 상단의 현재 상태를 확인한다.

최근 변경 기록: [DEV_261109.md](DEV_261109.md).
