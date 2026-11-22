"""
Evaluation pipeline v2: Data Validation → Unified LLM Judge
v1(pipeline.py)은 그대로 두고, 이 경로는 eval_version="v2"일 때만 쓴다.
기획: docs/Plan/PLAN_261117_EVAL_V2.md
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from threading import Lock
from typing import Any, Dict, List, Optional

from .data_validation import validate_dataset
from .qa_judge import JUDGE_VERSION, QAJudge, aggregate

logger = logging.getLogger(__name__)

EVAL_VERSION = "v2"


def _workers(evaluator_model: str) -> int:
    from .pipeline import _get_provider_workers
    return _get_provider_workers(evaluator_model)


try:
    from backend.ingestion.language import detect_language, hangul_ratio, EN_HANGUL_RATIO_MAX
except ImportError:
    from ingestion.language import detect_language, hangul_ratio, EN_HANGUL_RATIO_MAX

QA_MIN_LETTERS = 10   # 질문·답변은 짧아서 문서 판별 기준(200자)을 쓰면 항상 ko가 된다


def _detect_source(text: str) -> str:
    return detect_language([text])["language"]


def _detect_qa(text: str) -> str:
    letters = sum(1 for ch in text if ch.isascii() and ch.isalpha() or "가" <= ch <= "힣")
    if letters >= QA_MIN_LETTERS and hangul_ratio(text) < EN_HANGUL_RATIO_MAX:
        return "en"
    return "ko"


def resolve_languages(qa: Dict, qa_language: Optional[str] = None) -> Dict:
    """원문 언어와 QA 언어를 따로 정한다.
    - source: QA에 source_language가 있으면 그 값(청크 metadata), 없으면 컨텍스트로 판별
    - qa:     생성 설정 lang(=QA 출력 언어)이 있으면 그 값, 없으면 질문·답변으로 판별
    생성 설정 lang을 원문 언어로 쓰지 않는다."""
    src = qa.get("source_language")
    src_from = "metadata" if src in ("ko", "en") else "inferred"
    if src_from == "inferred":
        src = _detect_source(qa.get("context", ""))
    lang = qa.get("qa_language") or qa_language
    qa_from = "generation" if lang in ("ko", "en") else "inferred"
    if qa_from == "inferred":
        lang = _detect_qa(f"{qa.get('q', '')} {qa.get('a', '')}")
    return {"source_language": src, "qa_language": lang,
            "source_language_from": src_from, "qa_language_from": qa_from}


def run_v2_pipeline(
    qa_list: List[Dict],
    evaluator_model: str,
    eval_manager: Optional[Any] = None,
    job_id: Optional[str] = None,
    judge: Optional[QAJudge] = None,
    max_workers: Optional[int] = None,
    qa_language: Optional[str] = None,
) -> Dict:
    """qa_results[i]는 원본 qa_list[i]에 대응한다. 구문 탈락 QA는 skipped=True."""
    def _progress(message: str, progress: int):
        if eval_manager and job_id:
            eval_manager.update_job(job_id, message=message, progress=progress)

    _progress("데이터 검증 중...", 5)
    validation = validate_dataset(qa_list)
    valid_indices = validation["valid_indices"]
    _progress(f"데이터 검증 완료 ({validation['valid']}/{validation['total']} 통과)", 15)

    judge = judge or QAJudge(evaluator_model)
    workers = max_workers or _workers(evaluator_model)
    judged: Dict[int, Dict] = {}
    done = 0
    lock = Lock()

    def _one(i: int) -> Dict:
        qa = qa_list[i]
        langs = resolve_languages(qa, qa_language)
        r = judge.evaluate(i, qa.get("q", ""), qa.get("a", ""), qa.get("context", ""),
                           langs["source_language"], langs["qa_language"])
        return {**r, "source_language_from": langs["source_language_from"],
                "qa_language_from": langs["qa_language_from"]}

    if valid_indices:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(_one, i): i for i in valid_indices}
            for future in as_completed(futures):
                i = futures[future]
                judged[i] = future.result()   # APIQuotaExceededError는 그대로 올라간다
                with lock:
                    done += 1
                    cnt = done
                _progress(f"AI 품질 평가 중... ({cnt}/{len(valid_indices)})",
                          15 + int(cnt / len(valid_indices) * 80))

    judge_results = [judged[i] for i in valid_indices]
    summary = aggregate(judge_results)

    qa_results = []
    for i in range(len(qa_list)):
        if i in judged:
            qa_results.append(judged[i])
        else:
            qa_results.append({
                "qa_index": i, "skipped": True,
                "syntax_errors": validation["errors"].get(i, []),
            })

    validation_out = {k: v for k, v in validation.items() if k not in ("valid_indices", "errors")}
    return {
        "metadata": {
            "eval_version": EVAL_VERSION,
            "judge_version": JUDGE_VERSION,
            "evaluator_model": evaluator_model,
            "total_qa": len(qa_list),
            "timestamp": datetime.now().isoformat(),
        },
        "layers": {"validation": validation_out, "judge": summary},
        "qa_results": qa_results,
    }


# ============= 저장·화면용 결과 (v1 키와 호환) =============

V2_LAYER_KEYS = ("validation", "judge")


def _primary_failure(r: Dict) -> Optional[str]:
    if r.get("skipped"):
        return "syntax_error"
    if r.get("error"):
        return "evaluation_error"
    order = list(r.get("hard_fail_reasons") or []) + list(r.get("failure_types") or []) + list(r.get("fail_reasons") or [])
    return order[0] if order else None


def v2_qa_row(r: Dict, qa: Dict) -> Dict:
    """QA 하나의 v2 결과 + v1 화면이 읽는 키(rag_avg, quality_avg, pass, failure_types …)."""
    s = r.get("scores") or {}
    failure_types: List[str] = []
    if r.get("skipped"):
        failure_types = ["syntax_error"]
    elif r.get("error"):
        failure_types = ["evaluation_error"]
    else:
        failure_types = list(dict.fromkeys((r.get("failure_types") or []) + (r.get("fail_reasons") or [])))
    if r.get("skipped"):
        reason = "구문 검증 탈락 — " + "; ".join(r.get("syntax_errors") or [])
    elif r.get("error"):
        reason = f"평가 실패 — {r['error']}"
    else:
        reason = r.get("reason", "")
    status = "skipped" if r.get("skipped") else "error" if r.get("error") else \
        "pass" if r.get("pass") else "hard_fail" if r.get("hard_fail") else "fail"
    return {
        "qa_index":        r["qa_index"],
        "q":               qa.get("q", "")[:300],
        "a":               qa.get("a", "")[:500],
        "context":         qa.get("context", "")[:1000],
        "intent":          qa.get("intent", ""),
        "eval_version":    EVAL_VERSION,
        "v2_status":       status,
        # v1 호환 키
        "rag_avg":         r.get("qa_score"),
        "quality_avg":     r.get("qa_score"),
        "pass":            bool(r.get("pass")),
        "groundedness":    s.get("groundedness"),
        "completeness":    s.get("completeness"),
        "failure_types":   failure_types,
        "primary_failure": _primary_failure(r),
        "failure_reason":  reason,
        # v2
        "correctness":       s.get("correctness"),
        "question_quality":  s.get("question_quality"),
        "qa_score":          r.get("qa_score"),
        "hard_fail":         bool(r.get("hard_fail")),
        "hard_fail_reasons": r.get("hard_fail_reasons", []),
        "fail_reasons":      r.get("fail_reasons", []),
        "v2_failure_types":  r.get("failure_types", []),
        "evidence":          r.get("evidence", []),
        "language_checks":   r.get("language_checks", {}),
        "language_policy":   r.get("language_policy"),
        "source_language":   r.get("source_language"),
        "qa_language":       r.get("qa_language"),
        "source_language_from": r.get("source_language_from"),
        "reason":            r.get("reason", ""),
        "dimension_reasons": r.get("dimension_reasons", {}),   # v2.2부터. 이전 결과는 빈 값
        "evaluation_error":  r.get("error"),
    }


def build_v2_report(qa_list: List[Dict], out: Dict) -> Dict:
    """run_v2_pipeline 결과 → eval_report 일부(pipeline_results, qa_preview, summary).
    pipeline_results.layers.quality.qa_scores에 QA별 행을 넣는다. 이력 내보내기(RPC
    get_eval_qa_scores → build_export_detail)가 v1과 같은 경로로 읽기 때문이다.
    qa_index는 원본 qa_list 기준이다."""
    validation = out["layers"]["validation"]
    judge = out["layers"]["judge"]
    rows = [v2_qa_row(r, qa_list[r["qa_index"]]) for r in out["qa_results"]]
    syntax = {k: validation[k] for k in ("total", "valid", "invalid", "pass_rate", "errors_sample")}
    avg = judge["averages"]
    layers = {
        "syntax": syntax,
        "validation": validation,
        "judge": judge,
        # QA별 행은 quality에만 둔다(저장 크기). rag는 v1 화면의 요약 칸 호환용이다.
        "rag": {"evaluated_count": judge["evaluated_count"], "qa_scores": [],
                "summary": {"avg_groundedness": avg["groundedness"], "avg_score": judge["final_score"]}},
        "quality": {"evaluated_count": judge["evaluated_count"], "pass_count": judge["pass_count"],
                    "pass_rate": judge["pass_rate"], "qa_scores": rows,
                    "summary": {"avg_completeness": avg["completeness"], "avg_quality": judge["final_score"]}},
    }
    summary = {
        "eval_version":       EVAL_VERSION,
        "syntax_pass_rate":   validation["pass_rate"],
        "final_score":        judge["final_score"],
        "grade":              judge["grade"],
        "grade_withheld":     judge["grade_withheld"],
        "pass_count":         judge["pass_count"],
        "pass_rate":          judge["pass_rate"],
        "quality_pass_rate":  judge["pass_rate"],
        "hard_fail_count":    judge["hard_fail_count"],
        "evaluation_error_count": judge["evaluation_error_count"],
        "averages":           avg,
        "failure_counts":     judge["failure_counts"],
        "by_language_policy": judge["by_language_policy"],
        "duplicate_count":    len(validation["duplicates"]),
    }
    return {"layers": layers, "qa_preview": rows, "summary": summary}
