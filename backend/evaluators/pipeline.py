"""
Evaluation Pipeline
4단계 평가 파이프라인: run_full_evaluation_pipeline + run_evaluation (background task)
Layer 1-A, 2, 3는 ThreadPoolExecutor로 병렬 처리
"""
import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from threading import Lock
from typing import Dict, List, Optional, Any

from .job_manager import EvalJobStatus, EvaluationManager
from .syntax_validator import SyntaxValidator
from .dataset_stats import DatasetStats
from .rag_triad import RAGTriadEvaluator
from .qa_quality import QAQualityEvaluator
from .recommendations import generate_recommendations

logger = logging.getLogger(__name__)

# ============= Rate Limit 기반 프로바이더별 최대 워커 수 =============
PROVIDER_MAX_WORKERS: Dict[str, int] = {
    "anthropic": 2,   # 50 RPM / 50K TPM — claude-haiku/sonnet (Tier 1은 TPM이 낮아 2가 안전)
    "google":    10,  # 1,000 RPM — gemini-2.5-flash / 3.1-flash (Tier 1 Paid)
    "openai":    8,   # 500 RPM — gpt-5.1 / gpt-5.2
}
# Layer 1-A: API 없음, 순수 Python 연산
# 주의: os.cpu_count()는 컨테이너 환경(Render/Railway free tier)에서
#       호스트 전체 CPU 수를 반환할 수 있어 실제 할당 자원과 무관하게 큰 값이 나올 수 있음.
# → GIL 특성상 순수 Python은 멀티스레드 효과가 제한적이므로 4로 고정.
#   환경변수 SYNTAX_MAX_WORKERS로 오버라이드 가능.
SYNTAX_MAX_WORKERS: int = int(os.environ.get("SYNTAX_MAX_WORKERS", "4"))


def _get_provider_workers(evaluator_model: str) -> int:
    """evaluator_model 이름으로 provider 감지 → 권장 workers 반환"""
    m = evaluator_model.lower()
    if "claude" in m:
        return PROVIDER_MAX_WORKERS["anthropic"]
    if "gemini" in m:
        return PROVIDER_MAX_WORKERS["google"]
    return PROVIDER_MAX_WORKERS["openai"]


# TruApp은 병렬 workers에서 SQLite UNIQUE constraint 충돌을 유발하므로 사용하지 않음
# (TruLens SQLite 기록 대신 Supabase에 직접 저장)
TruApp = None

# Supabase
try:
    from config.supabase_client import (
        save_evaluation_to_supabase,
        link_generation_to_evaluation,
        is_supabase_available,
    )
except ImportError:
    try:
        from backend.config.supabase_client import (
            save_evaluation_to_supabase,
            link_generation_to_evaluation,
            is_supabase_available,
        )
    except ImportError:
        save_evaluation_to_supabase = None
        link_generation_to_evaluation = None
        is_supabase_available = lambda: False


# ============= 분포 통계 헬퍼 =============

def _distribution_stats(scores: list, key: str, threshold: float = 0.70) -> dict:
    """score 리스트에서 mean, std_dev, pct_below_threshold 계산"""
    values = [s.get(key, 0.0) for s in scores if key in s]
    n = max(len(values), 1)
    mean = sum(values) / n
    variance = sum((v - mean) ** 2 for v in values) / n
    std_dev = variance ** 0.5
    pct_below = sum(1 for v in values if v < threshold) / n * 100
    return {
        "mean":                round(mean, 3),
        "std_dev":             round(std_dev, 3),
        "pct_below_threshold": round(pct_below, 2),
        "threshold":           threshold,
    }


# ============= Worker 함수 =============

def _syntax_worker(args):
    """Layer 1-A: 단일 QA 구문 검증 worker"""
    i, qa, validator = args
    is_valid, errors = validator.validate_qa(qa)
    return i, is_valid, errors


def _classify_failure_types(rag: dict, quality: dict, context: str = "") -> dict:
    """차원 점수 기반 failure_type 분류 (복수값 + primary_failure 우선순위)"""
    PRIORITY = ["hallucination", "faithfulness_error", "retrieval_miss", "ambiguous_question", "bad_chunk", "evaluation_error"]
    failure_types = []

    groundedness = rag.get("groundedness", 1.0)
    relevance    = rag.get("relevance",    1.0)

    # groundedness < 0.4: 컨텍스트에 전혀 근거하지 않는 수준 → hallucination
    # (0.5는 정도 부사 복합 사용 수준 — hallucination으로 분류하지 않음)
    if groundedness < 0.4:
        failure_types.append("hallucination")
    # groundedness 0.4~0.6이고 relevance 괜찮으면 → faithfulness_error
    # relevance 낮으면 → retrieval_miss
    if 0.4 <= groundedness < 0.6 and relevance >= 0.6:
        failure_types.append("faithfulness_error")
    elif relevance < 0.6:
        failure_types.append("retrieval_miss")
    elif groundedness < 0.6:
        failure_types.append("faithfulness_error")
        failure_types.append("retrieval_miss")
    if rag.get("context_relevance", 1.0) < 0.6:
        failure_types.append("poor_context")
    ctx_len = len(context.strip()) if context else 0
    if ctx_len < 100:
        failure_types.append("bad_chunk")
    if "error" in quality or "error" in rag:
        failure_types.append("evaluation_error")

    # 점수 기반 pass 기준(0.70)과 failure_types 감지 기준(0.60) 갭 보완:
    # failure_types가 없어도 avg_quality < 0.70이면 low_quality 추가
    avg_quality = quality.get("avg_quality", 1.0)
    if not failure_types and avg_quality < 0.70:
        failure_types.append("low_quality")

    if not failure_types:
        return {"failure_types": [], "primary_failure": None, "failure_reason": "", "confidence": None}

    PRIORITY.append("low_quality")
    # 우선순위 기반 primary 선택
    primary = next((p for p in PRIORITY if p in failure_types), failure_types[0])

    reason_map = {
        "hallucination":      rag.get("groundedness_reason", ""),
        "faithfulness_error": rag.get("groundedness_reason", ""),
        "retrieval_miss":     rag.get("relevance_reason", "") or rag.get("groundedness_reason", ""),
        "poor_context":       rag.get("context_relevance_reason", ""),
        "bad_chunk":          f"컨텍스트 길이 {ctx_len}자 — 재생성 불가" if ctx_len < 100 else "",
        "evaluation_error":   quality.get("error", "") or rag.get("error", ""),
        "low_quality":        f"품질 점수 미달 (avg_quality={avg_quality:.2f}, 기준 0.70) — 개선 필요",
    }
    return {
        "failure_types":   failure_types,
        "primary_failure": primary,
        "failure_reason":  reason_map.get(primary, ""),
        "confidence":      None,  # 추후 LLM classifier로 보강
    }


def _rag_worker(args):
    """Layer 2: 단일 QA RAG Triad 평가 worker — score + reason 반환"""
    i, qa, rag_evaluator, job_id = args
    question = qa.get("q", "")
    answer   = qa.get("a", "")
    context  = qa.get("context", "")

    try:
        result = rag_evaluator.evaluate_all_with_reasons(question, answer, context)
        # 표준 RAG Triad: 관련성(answer) × 0.3 + 근거성 × 0.5 + 맥락성(context) × 0.2
        avg_score = (
            result["relevance"]           * 0.3
            + result["groundedness"]      * 0.5
            + result["context_relevance"] * 0.2
        )
        return i, {
            "qa_index":                    i,
            "relevance":                   round(result["relevance"], 3),
            "relevance_reason":            result.get("relevance_reason", ""),
            "groundedness":                round(result["groundedness"], 3),
            "groundedness_reason":         result.get("groundedness_reason", ""),
            "context_relevance":           round(result["context_relevance"], 3),
            "context_relevance_reason":    result.get("context_relevance_reason", ""),
            "avg_score":                   round(avg_score, 3),
        }
    except Exception as e:
        logger.warning(f"[{job_id}] RAG evaluation error at index {i}: {e}")
        return i, {"qa_index": i, "error": str(e), "avg_score": 0.65}


def _quality_worker(args):
    """Layer 3: 단일 QA Quality 평가 worker (completeness 단일 지표, 단일 LLM 호출)"""
    i, qa, quality_evaluator, job_id = args
    try:
        scores = quality_evaluator.evaluate_all(
            question=qa.get("q", ""),
            answer=qa.get("a", ""),
            context=qa.get("context", ""),
            intent=qa.get("intent", ""),
        )
        completeness = scores["completeness"]
        return i, {
            "qa_index":            i,
            "completeness":        round(completeness, 3),
            "coverage":            round(scores.get("coverage", 0.0), 3),
            "missing_aspects":     scores.get("missing_aspects", []),
            "completeness_reason": scores.get("completeness_reason", ""),
            "avg_quality":         round(completeness, 3),
            "pass":                completeness >= 0.70,
        }
    except Exception as e:
        logger.warning(f"[{job_id}] Quality evaluation error at index {i}: {e}")
        return i, {"qa_index": i, "error": str(e), "avg_quality": 0.65, "pass": False}


# ============= 메인 파이프라인 =============

def run_full_evaluation_pipeline(
    qa_list: List[Dict],
    layers: List[str] = None,
    evaluator_model: str = "gemini-2.5-flash",
    eval_manager: Optional[Any] = None,
    job_id: Optional[str] = None,
) -> Dict:
    """
    4단계 평가 파이프라인 (Layer 1-A, 2, 3은 병렬 처리)

    1️⃣ SyntaxValidator   - 구문 검증 ($0, 병렬)
    2️⃣ DatasetStats      - 통계 분석 ($0, 순차 - 집계 연산)
    3️⃣ RAGTriadEvaluator - RAG 평가 (비용有, 병렬)
    4️⃣ QAQualityEvaluator- CoT 품질 평가 (비용有, 병렬)
    """
    if layers is None:
        layers = ["syntax", "stats", "rag", "quality"]

    max_api_workers = _get_provider_workers(evaluator_model)
    logger.info(f"[{job_id}] Workers: syntax={SYNTAX_MAX_WORKERS}, api={max_api_workers} ({evaluator_model})")

    results = {
        "metadata": {
            "total_qa":        len(qa_list),
            "evaluator_model": evaluator_model,
            "layers":          layers,
            "timestamp":       datetime.now().isoformat(),
        },
        "layers": {"syntax": None, "stats": None, "rag": None, "quality": None},
    }

    valid_qa = qa_list
    valid_qa_orig_indices: list[int] = list(range(len(qa_list)))  # syntax 스킵 시 원본 그대로
    syntax_errors: dict = {}  # syntax 탈락 QA의 오류 정보

    # ===== Layer 1-A: SyntaxValidator (병렬) =====
    if "syntax" in layers:
        logger.info(f"[{job_id}] Layer 1-A: Syntax Validation (workers={SYNTAX_MAX_WORKERS})")
        if eval_manager and job_id:
            eval_manager.update_job(job_id, message="구문 검증 중...", progress=5)
            eval_manager.update_layer_status(job_id, "syntax", "running", 50, "필드, 타입, 길이 검증 중...")

        validator = SyntaxValidator()
        # 결과 순서 보장을 위해 dict로 수집 후 정렬
        results_map: Dict[int, tuple] = {}
        with ThreadPoolExecutor(max_workers=SYNTAX_MAX_WORKERS) as executor:
            futures = {
                executor.submit(_syntax_worker, (i, qa, validator)): i
                for i, qa in enumerate(qa_list)
            }
            for future in as_completed(futures):
                i, is_valid, errors = future.result()
                results_map[i] = (is_valid, errors)

        valid_qa_filtered, valid_qa_orig_indices, syntax_errors = [], [], {}
        for i in range(len(qa_list)):
            is_valid, errors = results_map[i]
            if is_valid:
                valid_qa_filtered.append(qa_list[i])
                valid_qa_orig_indices.append(i)
            else:
                syntax_errors[i] = errors

        valid_qa = valid_qa_filtered
        results["layers"]["syntax"] = {
            "total":    len(qa_list),
            "valid":    len(valid_qa),
            "invalid":  len(qa_list) - len(valid_qa),
            "pass_rate": round(len(valid_qa) / max(len(qa_list), 1) * 100, 2),
            "errors_sample": dict(list(syntax_errors.items())[:5]),
        }

        if eval_manager and job_id:
            eval_manager.update_job(job_id, message=f"구문 검증 완료 ({len(valid_qa)}/{len(qa_list)} 통과)", progress=15)
            eval_manager.update_layer_status(job_id, "syntax", "completed", 100, f"✓ {len(valid_qa)}/{len(qa_list)} 통과")
        logger.info(f"[{job_id}] Layer 1-A: {len(valid_qa)}/{len(qa_list)} passed")

    # ===== Layer 1-B: DatasetStats (순차 - 집계 연산) =====
    if "stats" in layers:
        logger.info(f"[{job_id}] Layer 1-B: Dataset Statistics")
        if eval_manager and job_id:
            eval_manager.update_job(job_id, message="통계 검증 중...", progress=30)

        dataset_stats = DatasetStats(qa_list).analyze_all()
        results["layers"]["stats"] = dataset_stats

        # 통계 요약 점수 계산 (UI 표시용)
        m = dataset_stats.get("metrics", {})
        avg_stat_score = round(sum(m.values()) / max(len(m), 1), 2) if m else 0

        if eval_manager and job_id:
            eval_manager.update_job(
                job_id,
                message=f"2️⃣ 데이터셋 분석 완료: 통계점수 {avg_stat_score}/10",
                progress=40
            )
            eval_manager.update_layer_status(job_id, "stats", "completed", 100, f"✓ 점수: {avg_stat_score}/10")
        logger.info(f"[{job_id}] Layer 1-B: avg_stat_score={avg_stat_score}")

    # ===== Layer 2: RAGTriadEvaluator (병렬) =====
    if "rag" in layers and valid_qa:
        logger.info(f"[{job_id}] Layer 2: RAG Triad (workers={max_api_workers})")
        if eval_manager and job_id:
            eval_manager.update_job(job_id, message=f"품질 평가 중... (0/{len(valid_qa)})", progress=45)
            eval_manager.update_layer_status(job_id, "rag", "running", 5, f"관련성, 근거성, 명확성 평가 중... (0/{len(valid_qa)})")

        rag_evaluator = RAGTriadEvaluator(evaluator_model)
        rag_scores: Dict[int, dict] = {}
        completed_count = 0
        progress_lock = Lock()

        with ThreadPoolExecutor(max_workers=max_api_workers) as executor:
            futures = {
                executor.submit(_rag_worker, (i, qa, rag_evaluator, job_id)): i
                for i, qa in enumerate(valid_qa)
            }
            for future in as_completed(futures):
                i, score = future.result()
                rag_scores[i] = score

                with progress_lock:
                    completed_count += 1
                    cnt = completed_count

                if eval_manager and job_id:
                    pct = int(cnt / len(valid_qa) * 100)
                    eval_manager.update_job(
                        job_id,
                        message=f"품질 평가(관련성, 근거성, 맥락성) 중... ({cnt}/{len(valid_qa)})",
                        progress=45 + int(pct * 0.25)
                    )
                    eval_manager.update_layer_status(job_id, "rag", "running", pct, f"{cnt}/{len(valid_qa)} 평가 완료")

        # 인덱스 순서대로 정렬
        rag_scores_list = [rag_scores[i] for i in range(len(valid_qa))]
        results["layers"]["rag"] = {
            "evaluated_count": len(valid_qa),
            "qa_scores": rag_scores_list,
            "summary": {
                "avg_relevance":         round(sum(s.get("relevance",         0.65) for s in rag_scores_list) / max(len(rag_scores_list), 1), 3),
                "avg_groundedness":      round(sum(s.get("groundedness",      0.65) for s in rag_scores_list) / max(len(rag_scores_list), 1), 3),
                "avg_context_relevance": round(sum(s.get("context_relevance", 0.65) for s in rag_scores_list) / max(len(rag_scores_list), 1), 3),
                "avg_score":             round(sum(s.get("avg_score",         0.65) for s in rag_scores_list) / max(len(rag_scores_list), 1), 3),
                "distribution": {
                    "relevance":         _distribution_stats(rag_scores_list, "relevance"),
                    # groundedness threshold=0.8: 수치 기반 주관적 표현(정도 부사)은 "틀린 답변"이 아닌
                    # "표현 방식" 수준이므로 0.8 미만만 미달로 처리. 생성 품질 개선 시 상향 검토.
                    "groundedness":      _distribution_stats(rag_scores_list, "groundedness", threshold=0.8),
                    "context_relevance": _distribution_stats(rag_scores_list, "context_relevance"),
                    "overall":           _distribution_stats(rag_scores_list, "avg_score"),
                },
            },
        }

        if eval_manager and job_id:
            rag_avg = results["layers"]["rag"]["summary"]["avg_score"]
            eval_manager.update_job(job_id, message=f"RAG 평가 완료 (평균: {rag_avg:.3f})", progress=70)
            eval_manager.update_layer_status(job_id, "rag", "completed", 100, f"✓ 점수: {rag_avg:.3f}")
        logger.info(f"[{job_id}] Layer 2: {len(valid_qa)} QA evaluated")

    # ===== Layer 3: QAQualityEvaluator (병렬) =====
    if "quality" in layers and valid_qa:
        logger.info(f"[{job_id}] Layer 3: Quality Evaluation (workers={max_api_workers})")
        if eval_manager and job_id:
            eval_manager.update_job(job_id, message=f"완전성 평가 중... (0/{len(valid_qa)})", progress=75)
            eval_manager.update_layer_status(job_id, "quality", "running", 5, f"완전성 CoT 평가 중... (0/{len(valid_qa)})")

        quality_evaluator = QAQualityEvaluator(evaluator_model)
        quality_scores: Dict[int, dict] = {}
        completed_count = 0
        progress_lock = Lock()

        with ThreadPoolExecutor(max_workers=max_api_workers) as executor:
            futures = {
                executor.submit(_quality_worker, (i, qa, quality_evaluator, job_id)): i
                for i, qa in enumerate(valid_qa)
            }
            for future in as_completed(futures):
                i, score = future.result()
                quality_scores[i] = score

                with progress_lock:
                    completed_count += 1
                    cnt = completed_count

                if eval_manager and job_id:
                    pct = int(cnt / len(valid_qa) * 100)
                    passed_so_far = sum(1 for s in quality_scores.values() if s.get("pass", False))
                    eval_manager.update_job(
                        job_id,
                        message=f"품질 평가(완전성) 중... ({cnt}/{len(valid_qa)}, 통과: {passed_so_far})",
                        progress=75 + int(pct * 0.25)
                    )
                    eval_manager.update_layer_status(job_id, "quality", "running", pct, f"{cnt}/{len(valid_qa)} 평가 완료 (통과: {passed_so_far})")

        # 인덱스 순서대로 정렬
        quality_scores_list = [quality_scores[i] for i in range(len(valid_qa))]
        passed = sum(1 for s in quality_scores_list if s.get("pass", False))
        pass_rate = round(passed / max(len(valid_qa), 1) * 100, 2)
        valid_qs = [s["avg_quality"] for s in quality_scores_list if "completeness" in s]

        results["layers"]["quality"] = {
            "evaluated_count": len(valid_qa),
            "pass_count":  passed,
            "pass_rate":   pass_rate,
            "qa_scores":   quality_scores_list,
            "summary": {
                "avg_completeness": round(sum(s.get("completeness", 0.65) for s in quality_scores_list) / max(len(quality_scores_list), 1), 3),
                "avg_quality":      round(sum(valid_qs) / max(len(valid_qs), 1), 3),
                "distribution": {
                    "completeness": _distribution_stats(quality_scores_list, "completeness"),
                    "overall":      _distribution_stats(quality_scores_list, "avg_quality"),
                },
            },
        }

        if eval_manager and job_id:
            quality_avg = results["layers"]["quality"]["summary"]["avg_quality"]
            eval_manager.update_job(job_id, message=f"품질 평가 완료 (평균: {quality_avg:.3f}, 통과: {pass_rate}%)", progress=85)
            eval_manager.update_layer_status(job_id, "quality", "completed", 100, f"✓ 점수: {quality_avg:.3f}, 통과율: {pass_rate}%")
        logger.info(f"[{job_id}] Layer 3: {passed}/{len(valid_qa)} passed ({pass_rate}%)")

    # ===== Failure Classification: quality.qa_scores에 failure 필드 추가 =====
    # rag + quality 두 레이어가 모두 완료된 후 한 번 순회하여 계산 → Supabase 저장 시 포함됨
    rag_layer     = results["layers"].get("rag")
    quality_layer = results["layers"].get("quality")
    if rag_layer and quality_layer:
        rag_scores_map: dict = {s["qa_index"]: s for s in rag_layer.get("qa_scores", [])}
        for q_score in quality_layer.get("qa_scores", []):
            if "primary_failure" in q_score:
                continue  # 이미 있으면 스킵 (재실행 방지)
            idx = q_score.get("qa_index", -1)
            r   = rag_scores_map.get(idx, {})
            ctx = valid_qa[idx].get("context", "") if 0 <= idx < len(valid_qa) else ""
            fi  = _classify_failure_types(r, q_score, ctx)
            q_score["failure_types"]   = fi.get("failure_types", [])
            q_score["primary_failure"] = fi.get("primary_failure")
            q_score["failure_reason"]  = fi.get("failure_reason", "")
            # hallucination / faithfulness_error 시 pass 취소
            # completeness가 높아도 근거 오류가 있으면 최종 통과 불가
            _HARD_FAIL = {"hallucination", "faithfulness_error"}
            if _HARD_FAIL & set(q_score["failure_types"]):
                q_score["pass"] = False

    results["overall_score"] = {
        "status":         "completed",
        "valid_qa_count": len(valid_qa),
        "timestamp":      datetime.now().isoformat(),
    }
    # qa_preview 빌드에 필요한 인덱스 정보를 함께 반환
    results["_valid_qa_orig_indices"] = valid_qa_orig_indices
    results["_syntax_errors"]         = syntax_errors
    return results


# ============= Background Task =============

def run_evaluation(
    job_id: str,
    result_filename: str,
    limit: Optional[int] = None,
    evaluator_model: str = "gemini-2.5-flash",
    eval_manager: Optional[EvaluationManager] = None,
    generation_id: Optional[str] = None,
):
    """Background task: 4단계 평가 파이프라인 실행"""
    if not eval_manager:
        return

    try:
        eval_manager.update_job(job_id, status=EvalJobStatus.RUNNING, message="평가 파이프라인 준비 중...")

        qa_list        = []
        gen_lang       = "ko"
        gen_model      = ""
        gen_prompt_ver = "v1"
        gen_source_doc = ""
        gen_h1         = ""
        gen_h2         = ""
        gen_h3         = ""

        # generation_id 있으면 Supabase에서 직접 읽기 (파일 불필요)
        if generation_id:
            from config.supabase_client import get_qa_generation_from_supabase
            gen_data = asyncio.run(get_qa_generation_from_supabase(generation_id))
            if gen_data:
                gen_meta       = gen_data.get("metadata", {})
                gen_lang       = gen_meta.get("lang", "ko")
                gen_model      = gen_meta.get("generation_model", "")
                gen_prompt_ver = gen_meta.get("prompt_version", "v1")
                gen_source_doc = gen_meta.get("source_doc", "")
                gen_h1         = gen_meta.get("hierarchy_h1", "")
                gen_h2         = gen_meta.get("hierarchy_h2", "")
                gen_h3         = gen_meta.get("hierarchy_h3", "")

                # qa_list 컬럼 = [{docId, text, qa_list: [{q,a,intent}]}, ...]
                # 로컬 파일 fallback과 동일하게 flatten + context 주입
                raw_results = gen_data.get("qa_list", [])
                for result_idx, result in enumerate(raw_results):
                    context = result.get("text", "")
                    for qa_idx, qa in enumerate(result.get("qa_list", [])):
                        qa_list.append({
                            "q":       qa.get("q", ""),
                            "a":       qa.get("a", ""),
                            "context": context[:10000],
                            "qa_id":   qa.get("qa_id", f"qa_{result_idx}_{qa_idx}"),
                            "intent":  qa.get("intent", ""),
                            "docId":   result.get("docId", ""),
                        })

                logger.info(f"[{job_id}] QA loaded from Supabase: {len(qa_list)} (generation_id={generation_id})")
            else:
                raise ValueError(f"generation_id {generation_id} 를 Supabase에서 찾을 수 없습니다.")
        else:
            raise ValueError("generation_id가 없습니다. Supabase에서 평가 대상을 조회할 수 없습니다.")

        if limit:
            qa_list = qa_list[:limit]

        logger.info(f"[{job_id}] Evaluation start: {len(qa_list)} QA items")
        eval_manager.update_job(job_id, message=f"평가 시작: {len(qa_list)} QA 분석 중...", progress=5)

        pipeline_results = run_full_evaluation_pipeline(
            qa_list=qa_list,
            layers=["syntax", "stats", "rag", "quality"],
            evaluator_model=evaluator_model,
            eval_manager=eval_manager,
            job_id=job_id,
        )

        logger.info(f"[{job_id}] Pipeline complete")

        syntax_data   = pipeline_results["layers"]["syntax"]
        stats_data    = pipeline_results["layers"]["stats"]
        rag_data      = pipeline_results["layers"]["rag"]
        quality_data  = pipeline_results["layers"]["quality"]

        valid_qa_count    = syntax_data["valid"]                      if syntax_data   else len(qa_list)
        syntax_pass_rate  = syntax_data["pass_rate"]                  if syntax_data   else 100
        dataset_quality   = stats_data.get("integrated_score", 5)    if stats_data    else 5
        rag_avg           = rag_data["summary"]["avg_score"]          if rag_data      else 0.65
        quality_avg       = quality_data["summary"]["avg_quality"]    if quality_data  else 0.65
        quality_pass_rate = quality_data["pass_rate"]                 if quality_data  else 0

        # 가중 합산 방식 (additive):
        #   Syntax 5% + Stats 5% + RAG Triad 65% + Completeness 25%
        # 예) rag=0.87, completeness=0.60 → 0.05+0.05+0.566+0.150 = 0.816 (B+)
        # 예) rag=0.87, completeness=1.00 → 0.05+0.05+0.566+0.250 = 0.916 (A+)
        final_score = (
            (syntax_pass_rate / 100)        * 0.05
            + (min(dataset_quality, 10) / 10) * 0.05
            + rag_avg                         * 0.65
            + quality_avg                     * 0.25
        )

        if   final_score >= 0.95: grade = "A+"
        elif final_score >= 0.85: grade = "A"
        elif final_score >= 0.75: grade = "B+"
        elif final_score >= 0.65: grade = "B"
        elif final_score >= 0.50: grade = "C"
        else:                     grade = "F"

        # QA 상세 미리보기 (프론트엔드 테이블용, 최대 100개)
        # rag/quality qa_scores는 valid_qa 기준 0-based 인덱스 → 원본 qa_list 인덱스로 재매핑
        valid_qa_orig_indices = pipeline_results.get("_valid_qa_orig_indices", list(range(len(qa_list))))
        syntax_errors         = pipeline_results.get("_syntax_errors", {})
        rag_by_idx: dict = {}
        for j, s in enumerate(rag_data["qa_scores"] if rag_data else []):
            orig = valid_qa_orig_indices[j] if j < len(valid_qa_orig_indices) else j
            rag_by_idx[orig] = s
        quality_by_idx: dict = {}
        for j, s in enumerate(quality_data["qa_scores"] if quality_data else []):
            orig = valid_qa_orig_indices[j] if j < len(valid_qa_orig_indices) else j
            quality_by_idx[orig] = s
        syntax_failed_set = set(syntax_errors.keys())
        qa_preview = []
        for i, qa in enumerate(qa_list):
            r = rag_by_idx.get(i, {})
            q = quality_by_idx.get(i, {})

            # syntax 탈락 QA: RAG/Quality 평가 없음 → 전용 failure_info 생성
            if i in syntax_failed_set:
                err_list   = syntax_errors.get(i) or []
                err_detail = "; ".join(err_list) if isinstance(err_list, list) else str(err_list)
                err_detail = err_detail or "구문 검증 실패"
                failure_info = {
                    "failure_types":   ["syntax_error"],
                    "primary_failure": "syntax_error",
                    "failure_reason":  f"구문 검증 탈락 — {err_detail}",
                    "confidence":      None,
                }
            else:
                failure_info = _classify_failure_types(r, q, qa.get("context", ""))

            qa_preview.append({
                "qa_index":            i,
                "q":                   qa.get("q", "")[:300],
                "a":                   qa.get("a", "")[:500],
                "context":             qa.get("context", "")[:1000],
                "intent":              qa.get("intent", ""),
                "rag_avg":             r.get("avg_score"),
                "quality_avg":         q.get("avg_quality"),
                # Individual scores
                "relevance":           r.get("relevance"),
                "groundedness":        r.get("groundedness"),
                "context_relevance":   r.get("context_relevance"),
                "completeness":        q.get("completeness"),
                "pass":                q.get("pass", False) and not failure_info.get("failure_types"),
                # RAG reason
                "relevance_reason":    r.get("relevance_reason", ""),
                "groundedness_reason": r.get("groundedness_reason", ""),
                "context_relevance_reason": r.get("context_relevance_reason", ""),
                # Quality reason
                "completeness_reason": q.get("completeness_reason", ""),
                "coverage":            q.get("coverage", 0.0),
                "missing_aspects":     q.get("missing_aspects", []),
                # Failure classification
                **failure_info,
            })

        # 평가 모델 model_id 변환 (키명 → 실제 버전)
        try:
            from config.models import MODEL_CONFIG as _MC
        except ImportError:
            from backend.config.models import MODEL_CONFIG as _MC
        evaluator_model_id = _MC.get(evaluator_model, {}).get("model_id", evaluator_model)

        eval_report = {
            "job_id":          job_id,
            "result_filename": result_filename,
            "timestamp":       datetime.now().isoformat(),
            "metadata": {
                "total_qa":         len(qa_list),
                "valid_qa":         valid_qa_count,
                "evaluator_model":  evaluator_model_id,
                "generation_model": gen_model,
                "source_doc":       gen_source_doc,
                "hierarchy_h1":     gen_h1,
                "hierarchy_h2":     gen_h2,
                "hierarchy_h3":     gen_h3,
            },
            "pipeline_results": {
                "syntax":  syntax_data,
                "stats":   stats_data,
                "rag":     rag_data,
                "quality": quality_data,
            },
            "qa_preview": qa_preview,
            "summary": {
                "syntax_pass_rate":      syntax_pass_rate,
                "dataset_quality_score": round(dataset_quality, 2),
                "rag_average_score":     round(rag_avg, 3),
                "quality_average_score": round(quality_avg, 3),
                "quality_pass_rate":     quality_pass_rate,
                "final_score":           round(final_score, 3),
                "grade":                 grade,
                "rag_distribution":      rag_data["summary"].get("distribution", {}) if rag_data else {},
                "quality_distribution":  quality_data["summary"].get("distribution", {}) if quality_data else {},
            },
            "interpretation": {
                "grade_meaning": {
                    "A+": "매우 우수한 QA 품질 (95% 이상)",
                    "A":  "우수한 QA 품질 (85% 이상)",
                    "B+": "좋은 QA 품질 (75% 이상)",
                    "B":  "그럭저럭 만족할 품질 (65% 이상)",
                    "C":  "개선 필요한 품질 (50% 이상)",
                    "F":  "재작업 필요 (50% 미만)",
                },
                # RecommendationsResult 구조 반환:
                #   dataset_level      List[str]          — 데이터셋 수준 ⚠️/✅ 메시지
                #   dimension_analysis Dict[str, dict]    — 차원별 severity/pct_below/std_dev
                #   failing_qa_items   List[dict]         — avg_score<0.70 QA, 최대 20개
                #   top_issues         List[str]          — 문제 차원 빈도 순
                "recommendations": generate_recommendations(
                    syntax_pass_rate, dataset_quality, rag_data, quality_data
                ),
            },
        }

        # Supabase 저장
        try:
            if is_supabase_available() and save_evaluation_to_supabase:
                scores = {
                    "syntax":  {"pass_rate": syntax_data.get("pass_rate", 100.0) if syntax_data else 100.0},
                    "stats":   {
                        "quality_score":    stats_data.get("integrated_score", 5.0) if stats_data else 5.0,
                        "diversity":        stats_data.get("diversity", 0.0) if stats_data else 0.0,
                        "duplication_rate": stats_data.get("duplication_rate", 0.0) if stats_data else 0.0,
                    },
                    "rag":     rag_data.get("summary", {})     if rag_data     else {},
                    "quality": quality_data.get("summary", {}) if quality_data else {},
                }
                supabase_eval_id = asyncio.run(save_evaluation_to_supabase(
                    job_id=job_id,
                    metadata={
                        "generation_model": gen_model,
                        "evaluator_model":  evaluator_model_id,
                        "lang":             gen_lang,
                        "prompt_version":   gen_prompt_ver,
                        "source_doc":       gen_source_doc,
                        "generation_id":    generation_id or "",
                        "hierarchy_h1":     gen_h1,
                        "hierarchy_h2":     gen_h2,
                        "hierarchy_h3":     gen_h3,
                    },
                    total_qa=len(qa_list),
                    valid_qa=valid_qa_count,
                    scores=scores,
                    final_score=round(final_score, 3),
                    final_grade=grade,
                    pipeline_results=pipeline_results,
                ))
                if supabase_eval_id:
                    logger.info(f"[{job_id}] Saved to Supabase: {supabase_eval_id}")
                    if generation_id and link_generation_to_evaluation:
                        linked = asyncio.run(link_generation_to_evaluation(generation_id, supabase_eval_id))
                        if linked:
                            logger.info(f"[{job_id}] Linked to generation: {generation_id}")
                        else:
                            logger.warning(f"[{job_id}] Failed to link generation {generation_id}")
                else:
                    logger.warning(f"[{job_id}] Supabase save returned None")
            else:
                logger.warning(f"[{job_id}] Supabase not available, skipping save")
        except Exception as e:
            logger.error(f"[{job_id}] Error saving to Supabase: {e}")

        eval_manager.update_job(
            job_id,
            status=EvalJobStatus.COMPLETED,
            progress=100,
            message=f"평가 완료! (등급: {grade}, 점수: {final_score:.3f})",
            eval_report=eval_report,
        )

    except Exception as e:
        logger.error(f"[{job_id}] Evaluation failed: {e}", exc_info=True)
        eval_manager.update_job(
            job_id,
            status=EvalJobStatus.FAILED,
            error=str(e),
            message=f"평가 실패: {str(e)}",
        )


# ── Export 공통 헬퍼 ─────────────────────────────────────────────────────────

def build_export_detail(qa_list_raw: list, pipeline_results: dict) -> list:
    """qa_gen_results.qa_list + pipeline_results 점수를 조인하여 export 행 목록 반환"""
    # qa_gen_results.qa_list 구조: [{docId, text, qa_list:[{q,a,intent,...}]}]
    flat_qa: list = []
    for result in qa_list_raw:
        context = result.get("text", "")
        for qa in result.get("qa_list", []):
            flat_qa.append({
                "q":       qa.get("q", ""),
                "a":       qa.get("a", ""),
                "context": context,
                "intent":  qa.get("intent", ""),
                "docId":   result.get("docId", ""),
            })

    layers = pipeline_results.get("layers", pipeline_results)  # in-memory vs Supabase 구조 대응
    rag_raw     = (layers.get("rag")     or {}).get("qa_scores", [])
    quality_raw = (layers.get("quality") or {}).get("qa_scores", [])
    rag_by_idx     = {s["qa_index"]: s for s in rag_raw}
    quality_by_idx = {s["qa_index"]: s for s in quality_raw}

    detail = []
    for i, qa in enumerate(flat_qa):
        r = rag_by_idx.get(i, {})
        q = quality_by_idx.get(i, {})

        # failure_types / primary_failure가 qa_scores에 저장되어 있으면 그대로 사용,
        # 없으면 _classify_failure_types로 재계산 (히스토리 로드 대응)
        failure_types   = q.get("failure_types")   or r.get("failure_types")
        primary_failure = q.get("primary_failure") or r.get("primary_failure")
        failure_reason  = q.get("failure_reason")  or r.get("failure_reason", "")

        if not failure_types and not primary_failure:
            try:
                fi = _classify_failure_types(r, q, qa.get("context", ""))
                failure_types   = fi.get("failure_types", [])
                primary_failure = fi.get("primary_failure")
                failure_reason  = fi.get("failure_reason", "")
            except Exception:
                failure_types   = []

        detail.append({
            "qa_index":            i,
            "q":                   qa["q"],
            "a":                   qa["a"],
            "context":             qa["context"],
            "intent":              qa["intent"],
            "docId":               qa["docId"],
            "rag_avg":             r.get("avg_score"),
            "quality_avg":         q.get("avg_quality"),
            "pass":                q.get("pass", False),
            # Individual scores
            "relevance":           r.get("relevance"),
            "groundedness":        r.get("groundedness"),
            "context_relevance":   r.get("context_relevance"),
            "completeness":        q.get("completeness"),
            # RAG reason
            "relevance_reason":          r.get("relevance_reason", ""),
            "groundedness_reason":       r.get("groundedness_reason", ""),
            "clarity_reason":            r.get("clarity_reason", ""),
            "context_relevance_reason":  r.get("context_relevance_reason", ""),
            # Quality reason
            "completeness_reason":  q.get("completeness_reason", ""),
            "factuality_reason":    q.get("factuality_reason", ""),
            "specificity_reason":   q.get("specificity_reason", ""),
            "conciseness_reason":   q.get("conciseness_reason", ""),
            # Failure classification
            "failure_types":       failure_types   or [],
            "primary_failure":     primary_failure or None,
            "failure_reason":      failure_reason,
        })
    return detail
