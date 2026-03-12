"""
Recommendations
평가 결과에 따른 개선 권고사항 생성
"""
from typing import List


def generate_recommendations(
    syntax_rate: float,
    stats_score: float,
    rag_score: float,
    quality_score: float,
) -> List[str]:
    """평가 결과에 따른 개선 권고사항 생성"""
    recommendations = []

    if syntax_rate < 90:
        recommendations.append("⚠️  구문 오류율이 높습니다. QA 데이터의 필수 필드(q, a, context)를 점검하세요.")

    if stats_score < 6:
        recommendations.append("⚠️  데이터 다양성이 낮습니다. 더 많은 intent와 문서 유형을 포함시키세요.")

    if rag_score < 0.70:
        recommendations.append("⚠️  RAG 평가 점수가 낮습니다. 답변과 컨텍스트의 관련성을 개선하세요.")

    if quality_score < 0.70:
        recommendations.append("⚠️  LLM 품질 평가 점수가 낮습니다. 답변의 사실성, 완전성, 근거성을 개선하세요.")

    if syntax_rate >= 95 and stats_score >= 7 and rag_score >= 0.80 and quality_score >= 0.80:
        recommendations.append("✅ 매우 우수한 QA 품질입니다! 현재 데이터로 좋은 성과를 기대할 수 있습니다.")

    if not recommendations:
        recommendations.append("✅ 전반적으로 양호한 QA 품질입니다. 지속적인 개선을 진행하세요.")

    return recommendations
