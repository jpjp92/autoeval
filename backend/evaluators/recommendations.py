"""
Recommendations
평가 결과에 따른 개선 권고사항 생성 (데이터셋 수준 + QA 아이템별 피드백)

반환 구조:
    RecommendationsResult = {
        "dataset_level":      List[str]   — 데이터셋 수준 메시지 (⚠️/✅)
        "dimension_analysis": Dict[str, DimensionInfo]
                              — 각 차원별 severity("ok"|"warning"|"critical"),
                                pct_below_threshold, std_dev, description
        "failing_qa_items":   List[FailingQAItem]
                              — avg_score < 0.70 인 QA, 점수 낮은 순 최대 20개
                                각 항목: {qa_index, avg_score, issues[{dimension, score, advice}]}
        "top_issues":         List[str]  — 문제 차원 빈도 순 이름 목록
    }
"""
from typing import Dict, List, Optional, TypedDict


class DimensionInfo(TypedDict):
    severity: str            # "ok" | "warning" | "critical"
    pct_below_threshold: float
    std_dev: float
    description: str


class FailingQAIssue(TypedDict):
    dimension: str
    score: float
    advice: str


class FailingQAItem(TypedDict):
    qa_index: int
    avg_score: float
    issues: List[FailingQAIssue]


class RecommendationsResult(TypedDict):
    dataset_level: List[str]
    dimension_analysis: Dict[str, DimensionInfo]
    failing_qa_items: List[FailingQAItem]
    top_issues: List[str]


# 차원별 임계치 및 설명 (한국어)
_DIMENSION_META = {
    "relevance":    (0.70, "답변이 질문 및 도메인 맥락에 부합하지 않음"),
    "groundedness": (0.70, "답변에 컨텍스트로 추적 불가한 주장이 포함됨"),
    "clarity":      (0.65, "질문 또는 답변 표현이 모호하거나 구조가 불명확함"),
    "factuality":   (0.70, "답변에 사실적으로 부정확하거나 뒷받침되지 않는 주장이 있음"),
    "completeness": (0.70, "답변이 질문의 모든 측면을 충분히 다루지 않음"),
    "specificity":  (0.65, "답변이 구체적 정보 대신 모호한 일반 표현을 사용함"),
    "conciseness":  (0.60, "답변이 질문 유형에 비해 지나치게 길거나 핵심이 묻혀 있음"),
}

_RAG_DIMS     = {"relevance", "groundedness", "clarity"}
_QUALITY_DIMS = {"factuality", "completeness", "specificity", "conciseness"}


def generate_recommendations(
    syntax_rate: float,
    stats_score: float,
    rag_data: Optional[Dict],
    quality_data: Optional[Dict],
) -> RecommendationsResult:
    """
    평가 결과에 따른 개선 권고사항 생성.

    Returns:
        {
            "dataset_level":      List[str],   # 데이터셋 수준 메시지
            "dimension_analysis": dict,         # 차원별 severity 분석
            "failing_qa_items":   List[dict],   # 하위 QA 아이템별 피드백 (최대 20개)
            "top_issues":         List[str],    # 가장 빈번한 문제 차원 순위
        }
    """
    dataset_msgs: List[str] = []
    dimension_analysis: Dict = {}
    failing_items: List[dict] = []

    # ── 데이터셋 수준 체크 ──────────────────────────────────────────────────
    if syntax_rate < 90:
        dataset_msgs.append("⚠️  구문 오류율이 높습니다. QA 데이터의 필수 필드(q, a, context)를 점검하세요.")
    if stats_score < 6:
        dataset_msgs.append("⚠️  데이터 다양성이 낮습니다. 더 많은 intent와 문서 유형을 포함시키세요.")

    rag_summary     = (rag_data or {}).get("summary", {})
    quality_summary = (quality_data or {}).get("summary", {})
    rag_avg         = rag_summary.get("avg_score", 1.0)
    quality_avg     = quality_summary.get("avg_quality", 1.0)

    if rag_avg < 0.70:
        dataset_msgs.append("⚠️  RAG 평가 점수가 낮습니다. 답변과 컨텍스트의 관련성·근거성을 개선하세요.")
    if quality_avg < 0.70:
        dataset_msgs.append("⚠️  LLM 품질 평가 점수가 낮습니다. 답변의 사실성, 완전성, 구체성, 간결성을 개선하세요.")
    if syntax_rate >= 95 and stats_score >= 7 and rag_avg >= 0.80 and quality_avg >= 0.80:
        dataset_msgs.append("✅ 매우 우수한 QA 품질입니다! 현재 데이터로 좋은 성과를 기대할 수 있습니다.")
    if not dataset_msgs:
        dataset_msgs.append("✅ 전반적으로 양호한 QA 품질입니다. 지속적인 개선을 진행하세요.")

    # ── 차원별 분포 분석 ───────────────────────────────────────────────────
    rag_dist     = rag_summary.get("distribution", {})
    quality_dist = quality_summary.get("distribution", {})
    issue_counts: Dict[str, float] = {}

    for dim, (threshold, description) in _DIMENSION_META.items():
        dist_block = rag_dist if dim in _RAG_DIMS else quality_dist
        dist = dist_block.get(dim, {})
        pct_below = dist.get("pct_below_threshold", 0.0)
        std_dev   = dist.get("std_dev", 0.0)

        if pct_below > 30:
            severity = "critical"
        elif pct_below > 15:
            severity = "warning"
        else:
            severity = "ok"

        dimension_analysis[dim] = {
            "severity":             severity,
            "pct_below_threshold":  pct_below,
            "std_dev":              std_dev,
            "description":          description if severity != "ok" else "",
        }
        if severity != "ok":
            issue_counts[dim] = pct_below

    # ── QA 아이템별 피드백 ─────────────────────────────────────────────────
    rag_scores_map  = {s["qa_index"]: s for s in (rag_data or {}).get("qa_scores", [])}
    qual_scores_map = {s["qa_index"]: s for s in (quality_data or {}).get("qa_scores", [])}
    all_indices     = set(rag_scores_map) | set(qual_scores_map)

    for idx in sorted(all_indices):
        r = rag_scores_map.get(idx, {})
        q = qual_scores_map.get(idx, {})
        avg = (r.get("avg_score", 1.0) + q.get("avg_quality", 1.0)) / 2
        if avg >= 0.70:
            continue

        issues = []
        for dim, (threshold, advice) in _DIMENSION_META.items():
            src = r if dim in _RAG_DIMS else q
            val = src.get(dim)
            if val is not None and val < threshold:
                issues.append({"dimension": dim, "score": round(val, 3), "advice": advice})

        if issues:
            failing_items.append({
                "qa_index":  idx,
                "avg_score": round(avg, 3),
                "issues":    sorted(issues, key=lambda x: x["score"]),  # 점수 낮은 순
            })

    # 최하위 20개만 반환
    failing_items.sort(key=lambda x: x["avg_score"])
    failing_items = failing_items[:20]

    top_issues = sorted(issue_counts, key=issue_counts.get, reverse=True)

    return {
        "dataset_level":      dataset_msgs,
        "dimension_analysis": dimension_analysis,
        "failing_qa_items":   failing_items,
        "top_issues":         top_issues,
    }
