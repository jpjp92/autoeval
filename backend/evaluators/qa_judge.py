"""
Unified LLM Judge (eval v2, Stage 2)
QA당 1회 호출로 groundedness / correctness / completeness / question_quality를 판정한다.
판정 실패는 점수로 대체하지 않고 error로 남긴다.
기획: docs/Plan/PLAN_261117_EVAL_V2.md 2-2, 2-3
"""
import json
import logging
import re
from typing import Dict, List, Optional

from .rag_triad import RAGTriadEvaluator, clean_markdown

try:
    from backend.exceptions import APIQuotaExceededError
except ImportError:
    from exceptions import APIQuotaExceededError

logger = logging.getLogger(__name__)

JUDGE_VERSION = "qa-judge-v2.1"   # v2.1: 언어 정책 추가
DIMENSIONS = ("groundedness", "correctness", "completeness", "question_quality")
WEIGHTS = {"groundedness": 0.35, "correctness": 0.30, "completeness": 0.20, "question_quality": 0.15}
HARD_FAIL_MIN = 0.6          # groundedness, correctness 하한
PASS_MIN = 0.70              # QA 점수 통과 기준
QUESTION_QUALITY_MIN = 0.5   # 지시어·답불가 질문은 가중 평균이 높아도 불통과
HARD_FAIL_PENALTY = 0.5      # 최종 점수에서 Hard Fail QA의 배율
MAX_ERROR_RATIO = 0.2        # 평가 실패가 이 비율을 넘으면 등급 보류
VERDICTS = {"supported", "unsupported", "contradicted"}
FAILURE_TYPES = {
    "unsupported_claim", "numeric_error", "incomplete", "unanswerable_question", "ambiguous_question",
    # 언어 정책별 세부 유형 (같은 문제를 별도 점수로 다시 감점하지 않는다. 4개 지표의 판정 근거로만 쓴다)
    "meaning_shift", "modality_mismatch", "negation_error", "unit_mismatch", "terminology_error", "condition_omitted",
}
LANGUAGES = ("ko", "en")
LANGUAGE_CHECKS = ("semantic_equivalence", "terminology_consistency", "numeric_consistency", "modality_preserved")

LANGUAGE_POLICIES = {
    "ko_ko": "korean_native",
    "en_en": "english_native",
    "en_ko": "cross_language_en_to_ko",
    "ko_en": "cross_language_ko_to_en",
}

_POLICY_RULES = {
    "korean_native": """Source and QA are both Korean. Pay extra attention to:
- negation and double negation (않다, 없다, 아니다, ~지 않으면 안 된다) and conditional clauses (~경우, ~한해)
- who a rule applies to, and exceptions/limits (다만, 제외, 단서 조항) — dropping one is "condition_omitted"
- particles and modifier scope that change meaning (은/는 vs 이/가, ~만, ~까지)
- numbers, dates, units and technical terms kept exactly
- natural Korean phrasing in the question (affects question_quality only)""",
    "english_native": """Source and QA are both English. Pay extra attention to:
- scientific terminology and acronyms used correctly ("terminology_error")
- hedging and modality (may, might, can, should, must) — turning a possibility into a fact is "modality_mismatch"
- negation and exception conditions ("negation_error", "condition_omitted")
- formulas, numbers, units, statistical significance (p-values, confidence intervals)
- grammatical, unambiguous question (affects question_quality only)""",
    "cross_language_en_to_ko": """The source is English and the QA is Korean. Compare meaning across languages:
- semantic equivalence: the Korean claim must mean what the English source says ("meaning_shift")
- percent vs percentage points (% vs %p), and units/scales kept ("unit_mismatch")
- modality: may/might/could must not become a definite statement (향상된다) ("modality_mismatch")
- negation: "not significant" must not become 유의미했다 ("negation_error") — this is a contradicted claim
- technical terms translated consistently, or kept in English ("terminology_error")
- nothing added that the source does not say""",
    "cross_language_ko_to_en": """The source is Korean and the QA is English. Compare meaning across languages:
- semantic equivalence: the English claim must mean what the Korean source says ("meaning_shift")
- Korean conditions, exceptions and scope (다만, 제외, ~한해) kept ("condition_omitted")
- proper nouns, organization and program names rendered recognizably ("terminology_error")
- numbers, dates, units kept (만/억 converted correctly, %p vs %) ("unit_mismatch")
- negation and modality preserved ("negation_error", "modality_mismatch")""",
}


def resolve_language_policy(source_language: str, qa_language: str) -> str:
    src = source_language if source_language in LANGUAGES else "ko"
    qa = qa_language if qa_language in LANGUAGES else "ko"
    return LANGUAGE_POLICIES[f"{src}_{qa}"]
CONTEXT_LIMIT = 8000


class JudgeParseError(ValueError):
    pass


def build_judge_prompt(question: str, answer: str, context: str, policy: str = "korean_native") -> str:
    ctx = (clean_markdown(context) or "")[:CONTEXT_LIMIT]
    rules = _POLICY_RULES.get(policy, _POLICY_RULES["korean_native"])
    return f"""<role>
You are a strict auditor of a synthetic QA dataset. Each QA pair was generated from the source below.
Judge the pair using ONLY the source. Do not use outside knowledge.
</role>

<source>
{ctx}
</source>

<question>{question}</question>
<answer>{answer}</answer>

<dimensions>
Score each dimension as an integer 0-10.

1. groundedness: Are the answer's claims supported by the source?
   Split the answer into atomic claims and judge each one:
   - supported: direct quote or unambiguous paraphrase; a calculated value (difference, ratio, sum,
     percentage change) whose inputs are all explicit in the source; a trend word ("감소세", "rising")
     whose underlying numbers are all in the source.
   - unsupported: not in the source, needs outside knowledge, or a subjective label not in the source.
   - contradicted: conflicts with the source.
   score = round(supported_claims / total_claims * 10).

2. correctness: Do numbers, units, dates, names and conditions match the source exactly?
   For tables, check that the value comes from the right row AND column (region, period, category).
   - 10: every figure and condition matches
   - 5-7: a minor slip that does not change the meaning (rounding, unit spelled differently)
   - 0-4: a wrong number, wrong row/column, wrong period, or wrong unit
   If the answer contains no figures or conditions, judge factual accuracy of its statements.

3. completeness: Does the answer address every part the question asks for?
   Split the question into sub-questions. An off-topic answer scores 0-2.
   Answering 1 of N requested items scores at most 6. Do not reward verbosity.

4. question_quality: Is the question a good standalone dataset question?
   - answerable from the source alone (if not: 0-3, failure "unanswerable_question")
   - clear and specific, one reasonable interpretation (if not: failure "ambiguous_question")
   - readable without the source: no references like "이 문서에서", "위 표", "according to the text"
     (deduct 2-4 points)
</dimensions>

<language_policy name="{policy}">
{rules}
Use these checks as evidence for the four dimensions above (meaning or number errors lower
groundedness/correctness; omitted conditions lower completeness). Do not add separate penalties.
</language_policy>

<output>
Return ONLY valid JSON, no markdown:
{{"groundedness": <0-10>, "correctness": <0-10>, "completeness": <0-10>, "question_quality": <0-10>,
 "evidence": [{{"claim": "<answer claim>", "source": "<short quote from the source, original language>", "verdict": "supported|unsupported|contradicted"}}],
 "language_checks": {{"semantic_equivalence": true|false, "terminology_consistency": true|false, "numeric_consistency": true|false, "modality_preserved": true|false}},
 "failure_types": [<zero or more of "unsupported_claim", "numeric_error", "incomplete", "unanswerable_question", "ambiguous_question", "meaning_shift", "modality_mismatch", "negation_error", "unit_mismatch", "terminology_error", "condition_omitted">],
 "reason": "<1 concise sentence in Korean explaining the main issue, or why it is fine>"}}
List at most 6 claims in evidence, most important first.
</output>"""


def _extract_json(raw: str) -> dict:
    text = re.sub(r"```(?:json)?", "", raw or "").replace("```", "").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise JudgeParseError("no JSON object in judge response")
        try:
            data = json.loads(text[start:end + 1])
        except json.JSONDecodeError as e:
            raise JudgeParseError(f"invalid JSON: {e}") from e
    if not isinstance(data, dict):
        raise JudgeParseError("judge response is not an object")
    return data


def parse_judge_response(raw: str) -> Dict:
    """0-10 점수를 0-1로 바꾼다. 점수가 빠졌거나 숫자가 아니면 JudgeParseError."""
    data = _extract_json(raw)
    scores = {}
    for dim in DIMENSIONS:
        val = data.get(dim)
        if isinstance(val, bool) or not isinstance(val, (int, float, str)):
            raise JudgeParseError(f"missing score: {dim}")
        try:
            num = float(val)
        except ValueError as e:
            raise JudgeParseError(f"non-numeric score: {dim}") from e
        scores[dim] = round(min(10.0, max(0.0, num)) / 10.0, 3)

    evidence = []
    for item in data.get("evidence") or []:
        if not isinstance(item, dict):
            continue
        verdict = str(item.get("verdict", "")).strip().lower()
        evidence.append({
            "claim": str(item.get("claim", ""))[:500],
            "source": str(item.get("source", ""))[:500],
            "verdict": verdict if verdict in VERDICTS else "unsupported",
        })

    failure_types = [f for f in (data.get("failure_types") or []) if f in FAILURE_TYPES]
    raw_checks = data.get("language_checks") if isinstance(data.get("language_checks"), dict) else {}
    language_checks = {k: raw_checks[k] for k in LANGUAGE_CHECKS if isinstance(raw_checks.get(k), bool)}
    return {
        "language_checks": language_checks,
        "scores": scores,
        "evidence": evidence,
        "failure_types": list(dict.fromkeys(failure_types)),
        "reason": str(data.get("reason", ""))[:500],
    }


def score_qa(parsed: Dict) -> Dict:
    """QA 점수, Hard Fail, 통과 여부."""
    s = parsed["scores"]
    qa_score = sum(s[d] * WEIGHTS[d] for d in DIMENSIONS)
    hard_fail_reasons = []
    if s["groundedness"] < HARD_FAIL_MIN:
        hard_fail_reasons.append("low_groundedness")
    if s["correctness"] < HARD_FAIL_MIN:
        hard_fail_reasons.append("low_correctness")
    if any(e["verdict"] == "contradicted" for e in parsed.get("evidence", [])):
        hard_fail_reasons.append("contradicted_claim")
    hard_fail = bool(hard_fail_reasons)
    fail_reasons = list(hard_fail_reasons)
    if qa_score < PASS_MIN:
        fail_reasons.append("low_score")
    if s["question_quality"] < QUESTION_QUALITY_MIN:
        fail_reasons.append("low_question_quality")
    return {
        "qa_score": round(qa_score, 3),
        "hard_fail": hard_fail,
        "hard_fail_reasons": hard_fail_reasons,
        "fail_reasons": fail_reasons,
        "pass": not fail_reasons,
    }


def grade_for(score: float) -> str:
    if score >= 0.95: return "A+"
    if score >= 0.85: return "A"
    if score >= 0.75: return "B+"
    if score >= 0.65: return "B"
    if score >= 0.50: return "C"
    return "F"


def aggregate(results: List[Dict]) -> Dict:
    """QA별 결과 → 요약. error가 있는 QA는 점수·통과율 계산에서 뺀다."""
    judged = [r for r in results if not r.get("error")]
    errors = len(results) - len(judged)
    n = len(judged)
    averages = {d: (round(sum(r["scores"][d] for r in judged) / n, 3) if n else None) for d in DIMENSIONS}
    passed = sum(1 for r in judged if r["pass"])
    hard_fails = sum(1 for r in judged if r["hard_fail"])
    if n:
        final = sum(r["qa_score"] * (HARD_FAIL_PENALTY if r["hard_fail"] else 1.0) for r in judged) / n
        final = round(final, 3)
    else:
        final = None

    error_ratio = errors / len(results) if results else 0.0
    grade_withheld = None
    if final is None:
        grade_withheld = "no_judged_qa"
    elif error_ratio > MAX_ERROR_RATIO:
        grade_withheld = "too_many_evaluation_errors"

    failure_counts: Dict[str, int] = {}
    for r in judged:
        for f in r.get("failure_types", []):
            failure_counts[f] = failure_counts.get(f, 0) + 1

    by_policy: Dict[str, Dict] = {}
    for r in judged:
        p = by_policy.setdefault(r.get("language_policy", "korean_native"), {"judged": 0, "pass": 0, "score_sum": 0.0})
        p["judged"] += 1
        p["pass"] += 1 if r["pass"] else 0
        p["score_sum"] += r["qa_score"]
    by_policy = {k: {"judged": v["judged"], "pass_rate": round(v["pass"] / v["judged"] * 100, 2),
                     "avg_qa_score": round(v["score_sum"] / v["judged"], 3)} for k, v in by_policy.items()}

    return {
        "judge_version": JUDGE_VERSION,
        "by_language_policy": by_policy,
        "evaluated_count": len(results),
        "judged_count": n,
        "evaluation_error_count": errors,
        "pass_count": passed,
        "pass_rate": round(passed / n * 100, 2) if n else 0.0,
        "hard_fail_count": hard_fails,
        "averages": averages,
        "failure_counts": failure_counts,
        "final_score": final,
        "grade": None if grade_withheld else grade_for(final),
        "grade_withheld": grade_withheld,
        "weights": dict(WEIGHTS),
    }


def _is_quota_error(err: Exception) -> bool:
    s = str(err).lower()
    return "429" in s or "quota" in s or "resource_exhausted" in s


class QAJudge:
    """판정 모델은 RAGTriadEvaluator와 같은 방식으로 만든다(프로바이더별 설정 공유)."""

    def __init__(self, evaluator_model: str, judge_model=None):
        if judge_model is not None:
            self.judge_model = judge_model
            self.evaluator_model = evaluator_model
        else:
            base = RAGTriadEvaluator(evaluator_model)
            self.judge_model = base.judge_model
            self.evaluator_model = base.evaluator_model

    def evaluate(self, qa_index: int, question: str, answer: str, context: str,
                 source_language: str = "ko", qa_language: str = "ko") -> Dict:
        policy = resolve_language_policy(source_language, qa_language)
        base = {"qa_index": qa_index, "judge_version": JUDGE_VERSION,
                "source_language": source_language, "qa_language": qa_language, "language_policy": policy}
        if not self.judge_model:
            return {**base, "error": "judge_unavailable"}
        try:
            response = self.judge_model.invoke(build_judge_prompt(question, answer, context, policy))
            raw = response.text
        except Exception as e:
            if _is_quota_error(e):
                raise APIQuotaExceededError(f"평가 모델 API 한도 초과: {e}") from e
            logger.warning(f"Judge call failed at {qa_index}: {e}")
            return {**base, "error": f"judge_call_error: {e}"[:300]}
        try:
            parsed = parse_judge_response(raw or "")
        except JudgeParseError as e:
            logger.warning(f"Judge parse failed at {qa_index}: {e}; raw={str(raw)[:200]}")
            return {**base, "error": f"judge_parse_error: {e}"[:300]}
        return {**base, **parsed, **score_qa(parsed)}
