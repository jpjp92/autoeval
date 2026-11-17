"""
Data Validation (eval v2, Stage 1)
결정론적 검사. 점수를 만들지 않는다.
- 구문 탈락(Hard Fail): 평가 대상에서 제외
- 중복 의심, 분포, 경고: 정보성 진단
- 문서 분포·쏠림은 QA에 source_doc이 있을 때만 (docId는 청크 ID)
기획: docs/Plan/PLAN_261117_EVAL_V2.md 2-1
"""
from collections import Counter
from difflib import SequenceMatcher
from typing import Dict, List

from .syntax_validator import SyntaxValidator

DUPLICATE_SIMILARITY = 0.7     # v1 DatasetStats와 같은 기준
DOC_SKEW_WARN_RATIO = 0.5      # 문서가 2개 이상일 때만 적용
ERRORS_SAMPLE_SIZE = 5


def _normalize_question(q: str) -> str:
    return " ".join((q or "").lower().split())


def find_duplicate_questions(qa_list: List[Dict], threshold: float = DUPLICATE_SIMILARITY) -> List[Dict]:
    """같거나 거의 같은 질문 쌍. 앞의 QA를 기준으로, 이미 짝지어진 QA는 다시 비교하지 않는다."""
    questions = [_normalize_question(qa.get("q", "")) for qa in qa_list]
    pairs: List[Dict] = []
    matched = set()
    for i, q_i in enumerate(questions):
        if i in matched or not q_i:
            continue
        for j in range(i + 1, len(questions)):
            if j in matched or not questions[j]:
                continue
            if q_i == questions[j]:
                ratio = 1.0
            else:
                ratio = SequenceMatcher(None, q_i, questions[j]).ratio()
            if ratio >= threshold:
                pairs.append({"a": i, "b": j, "similarity": round(ratio, 3), "exact": ratio == 1.0})
                matched.add(j)
    return pairs


def validate_dataset(qa_list: List[Dict]) -> Dict:
    """Stage 1 결과. valid_indices는 원본 qa_list 기준 인덱스다."""
    valid_indices: List[int] = []
    errors: Dict[int, List[str]] = {}
    for i, qa in enumerate(qa_list):
        ok, errs = SyntaxValidator.validate_qa(qa)
        if ok:
            valid_indices.append(i)
        else:
            errors[i] = errs

    duplicates = find_duplicate_questions(qa_list)
    intent_dist = Counter(qa.get("intent") or "unknown" for qa in qa_list if isinstance(qa, dict))
    # 문서 분포는 문서명(source_doc)이 있을 때만 센다. docId는 청크 ID라 문서 쏠림 판단에 쓰면 안 된다.
    doc_dist = Counter(qa["source_doc"] for qa in qa_list if isinstance(qa, dict) and qa.get("source_doc"))

    warnings: List[Dict] = []
    if errors:
        warnings.append({"code": "syntax_invalid", "count": len(errors)})
    if duplicates:
        warnings.append({"code": "duplicate_questions", "count": len(duplicates)})
    total = sum(doc_dist.values())
    if len(doc_dist) >= 2 and total:
        top_doc, top_n = doc_dist.most_common(1)[0]
        if top_n / total > DOC_SKEW_WARN_RATIO:
            warnings.append({"code": "doc_skew", "doc": top_doc, "ratio": round(top_n / total, 3)})

    return {
        "total": len(qa_list),
        "valid": len(valid_indices),
        "invalid": len(errors),
        "pass_rate": round(len(valid_indices) / max(len(qa_list), 1) * 100, 2),
        "valid_indices": valid_indices,
        "errors": errors,
        "errors_sample": dict(list(errors.items())[:ERRORS_SAMPLE_SIZE]),
        "duplicates": duplicates,
        "duplicate_qa_count": len({i for d in duplicates for i in (d["a"], d["b"])}),
        "intent_distribution": dict(intent_dist),
        "doc_distribution": dict(doc_dist),
        "warnings": warnings,
    }
