"""eval v2: Data Validation, Judge 파싱·점수, 파이프라인, v1 실패 표시. LLM은 mock.

Run: python -m unittest backend.tests.test_eval_v2
"""

import json
import unittest
from unittest import mock

from langchain_core.messages import AIMessage

from backend.exceptions import APIQuotaExceededError
from backend.evaluators import qa_judge
from backend.evaluators.data_validation import find_duplicate_questions, validate_dataset
from backend.evaluators.pipeline import _quality_worker, _rag_worker, build_export_detail
from backend.evaluators.pipeline_v2 import build_v2_report, resolve_languages, run_v2_pipeline
from backend.evaluators.qa_judge import (
    JudgeParseError, QAJudge, aggregate, build_judge_prompt, parse_judge_response,
    resolve_language_policy, score_qa,
)
from backend.evaluators.qa_quality import QAQualityEvaluator
from backend.evaluators.rag_triad import RAGTriadEvaluator

CTX = "서울 아파트 매매가격은 11월 셋째 주 0.20% 올랐다. 부산은 0.05% 내렸다. " * 2


def qa(q="서울 아파트 매매가격은 얼마나 올랐나?", a="0.20% 올랐다.", **kw):
    return {"q": q, "a": a, "context": CTX, "intent": "fact", "docId": "doc1", **kw}


def judge_json(g=10, c=10, comp=10, qq=10, evidence=None, failures=None):
    return json.dumps({
        "groundedness": g, "correctness": c, "completeness": comp, "question_quality": qq,
        "evidence": evidence or [{"claim": "0.20% 상승", "source": "0.20% 올랐다", "verdict": "supported"}],
        "failure_types": failures or [], "reason": "원문과 일치한다.",
    })


class FakeModel:
    """질문 문자열로 응답을 고른다. 응답이 Exception이면 던진다."""

    def __init__(self, by_question, default=None):
        self.by_question = by_question
        self.default = default if default is not None else judge_json()

    def invoke(self, prompt):
        for key, resp in self.by_question.items():
            if f"<question>{key}</question>" in prompt:
                if isinstance(resp, Exception):
                    raise resp
                return AIMessage(content=resp)
        return AIMessage(content=self.default)


class DataValidationTests(unittest.TestCase):
    def test_syntax_fail_excluded_and_duplicates_flagged(self):
        items = [qa(), qa(q="서울 아파트 매매가격은 얼마나 올랐나요?"), qa(a=""), qa(q="부산 가격은?")]
        v = validate_dataset(items)
        self.assertEqual(v["valid_indices"], [0, 1, 3])
        self.assertEqual(list(v["errors"]), [2])
        self.assertEqual([(d["a"], d["b"]) for d in v["duplicates"]], [(0, 1), (0, 2)])
        codes = {w["code"] for w in v["warnings"]}
        self.assertEqual(codes, {"syntax_invalid", "duplicate_questions"})

    def test_single_document_is_not_skew(self):
        v = validate_dataset([qa(q=f"질문 {i}번 내용은 무엇인가?") for i in range(5)])
        self.assertNotIn("doc_skew", {w["code"] for w in v["warnings"]})

    def test_skew_warning_with_multiple_documents(self):
        items = [qa(q=f"질문 {i}번 내용은 무엇인가?", source_doc="a.pdf") for i in range(4)] + [qa(source_doc="b.pdf")]
        v = validate_dataset(items)
        skew = [w for w in v["warnings"] if w["code"] == "doc_skew"]
        self.assertEqual(skew, [{"code": "doc_skew", "doc": "a.pdf", "ratio": 0.8}])

    def test_chunk_ids_are_not_documents(self):
        items = [qa(q=f"질문 {i}번 내용은 무엇인가?", docId="chunk-a") for i in range(4)] + [qa(docId="chunk-b")]
        v = validate_dataset(items)
        self.assertEqual(v["doc_distribution"], {})
        self.assertNotIn("doc_skew", {w["code"] for w in v["warnings"]})

    def test_duplicate_qa_count_differs_from_pairs(self):
        items = [qa(), qa(q="서울 아파트 매매가격은 얼마나 올랐나요?"), qa(q="서울 아파트 매매가격은 얼마나 올랐나??"), qa(q="부산 가격은?")]
        v = validate_dataset(items)
        self.assertEqual((len(v["duplicates"]), v["duplicate_qa_count"]), (2, 3))

    def test_exact_duplicate_marked(self):
        self.assertEqual(find_duplicate_questions([qa(), qa(q="  서울 아파트  매매가격은 얼마나 올랐나? ")]),
                         [{"a": 0, "b": 1, "similarity": 1.0, "exact": True}])


class JudgeParseTests(unittest.TestCase):
    def test_plain_fenced_and_wrapped_json(self):
        body = judge_json(9, 8, 7, 6)
        for raw in (body, f"```json\n{body}\n```", f"판정 결과:\n{body}\n끝"):
            with self.subTest(raw=raw[:12]):
                p = parse_judge_response(raw)
                self.assertEqual(p["scores"], {"groundedness": 0.9, "correctness": 0.8,
                                               "completeness": 0.7, "question_quality": 0.6})

    def test_clamps_and_filters(self):
        raw = json.dumps({"groundedness": 12, "correctness": -1, "completeness": "7", "question_quality": 7.5,
                          "evidence": [{"claim": "x", "verdict": "WRONG"}, "bad"],
                          "failure_types": ["numeric_error", "made_up", "numeric_error"]})
        p = parse_judge_response(raw)
        self.assertEqual(p["scores"]["groundedness"], 1.0)
        self.assertEqual(p["scores"]["correctness"], 0.0)
        self.assertEqual(p["scores"]["question_quality"], 0.75)
        self.assertEqual(p["evidence"], [{"claim": "x", "source": "", "verdict": "unsupported"}])
        self.assertEqual(p["failure_types"], ["numeric_error"])

    def test_missing_or_bad_score_raises(self):
        for raw in ("not json", "[]", json.dumps({"groundedness": 9}),
                    json.dumps({"groundedness": 9, "correctness": None, "completeness": 9, "question_quality": 9}),
                    json.dumps({"groundedness": "high", "correctness": 9, "completeness": 9, "question_quality": 9})):
            with self.subTest(raw=raw):
                with self.assertRaises(JudgeParseError):
                    parse_judge_response(raw)


class ScoringTests(unittest.TestCase):
    def test_weighted_score_and_pass(self):
        r = score_qa(parse_judge_response(judge_json(10, 10, 5, 10)))
        self.assertEqual(r["qa_score"], 0.9)          # 0.35+0.30+0.10+0.15
        self.assertTrue(r["pass"])
        self.assertFalse(r["hard_fail"])

    def test_hard_fail_overrides_average(self):
        r = score_qa(parse_judge_response(judge_json(10, 5, 10, 10)))   # numeric error
        self.assertEqual(r["qa_score"], 0.85)
        self.assertEqual(r["hard_fail_reasons"], ["low_correctness"])
        self.assertFalse(r["pass"])
        contradicted = [{"claim": "부산 상승", "source": "부산은 0.05% 내렸다", "verdict": "contradicted"}]
        r = score_qa(parse_judge_response(judge_json(9, 9, 9, 9, evidence=contradicted)))
        self.assertEqual(r["hard_fail_reasons"], ["contradicted_claim"])

    def test_low_question_quality_fails_without_penalty(self):
        r = score_qa(parse_judge_response(judge_json(10, 10, 10, 2)))   # "위 표에서 …" 질문
        self.assertEqual(r["qa_score"], 0.88)
        self.assertFalse(r["hard_fail"])
        self.assertEqual(r["fail_reasons"], ["low_question_quality"])
        self.assertFalse(r["pass"])

    def test_aggregate_excludes_errors_and_withholds_grade(self):
        ok = {**parse_judge_response(judge_json()), **score_qa(parse_judge_response(judge_json()))}
        bad = {**parse_judge_response(judge_json(10, 4, 10, 10)),
               **score_qa(parse_judge_response(judge_json(10, 4, 10, 10)))}
        s = aggregate([ok, ok, ok, bad, {"error": "judge_parse_error"}])
        self.assertEqual((s["judged_count"], s["evaluation_error_count"]), (4, 1))
        self.assertEqual((s["pass_count"], s["hard_fail_count"]), (3, 1))
        # bad qa_score = 0.35+0.12+0.20+0.15 = 0.82, halved = 0.41 → (3 + 0.41)/4
        self.assertEqual(s["final_score"], 0.853)
        self.assertEqual(s["grade"], "A")
        s = aggregate([ok, ok, ok, {"error": "x"}])          # 25% errors
        self.assertIsNone(s["grade"])
        self.assertEqual(s["grade_withheld"], "too_many_evaluation_errors")
        s = aggregate([{"error": "x"}])
        self.assertEqual((s["final_score"], s["grade_withheld"]), (None, "no_judged_qa"))


class JudgeCallTests(unittest.TestCase):
    def test_errors_are_recorded_not_scored(self):
        judge = QAJudge("fake", judge_model=FakeModel({"q1?": "garbage", "q2?": RuntimeError("timeout")}))
        r1 = judge.evaluate(0, "q1?", "a", CTX)
        r2 = judge.evaluate(1, "q2?", "a", CTX)
        self.assertTrue(r1["error"].startswith("judge_parse_error"))
        self.assertTrue(r2["error"].startswith("judge_call_error"))
        self.assertNotIn("scores", r1)

    def test_quota_error_propagates(self):
        judge = QAJudge("fake", judge_model=FakeModel({"q?": RuntimeError("429 RESOURCE_EXHAUSTED")}))
        with self.assertRaises(APIQuotaExceededError):
            judge.evaluate(0, "q?", "a", CTX)

    def test_content_blocks(self):
        model = FakeModel({})
        model.default = [{"type": "reasoning", "reasoning": "x"}, {"type": "text", "text": judge_json(9, 9, 9, 9)}]
        r = QAJudge("fake", judge_model=model).evaluate(0, "q?", "a", CTX)
        self.assertEqual(r["scores"]["groundedness"], 0.9)


class LanguagePolicyTests(unittest.TestCase):
    def test_policy_matrix(self):
        self.assertEqual(resolve_language_policy("ko", "ko"), "korean_native")
        self.assertEqual(resolve_language_policy("en", "en"), "english_native")
        self.assertEqual(resolve_language_policy("en", "ko"), "cross_language_en_to_ko")
        self.assertEqual(resolve_language_policy("ko", "en"), "cross_language_ko_to_en")
        self.assertEqual(resolve_language_policy("ja", None), "korean_native")

    def test_prompt_carries_policy_rules(self):
        p = build_judge_prompt("q", "a", CTX, "cross_language_en_to_ko")
        self.assertIn('<language_policy name="cross_language_en_to_ko">', p)
        self.assertIn("% vs %p", p)
        self.assertNotIn("다만, 제외, 단서 조항", p)

    def test_language_checks_parsed_as_diagnostics_only(self):
        raw = json.loads(judge_json())
        raw["language_checks"] = {"modality_preserved": False, "numeric_consistency": "yes", "extra": True}
        raw["failure_types"] = ["modality_mismatch"]
        p = parse_judge_response(json.dumps(raw))
        self.assertEqual(p["language_checks"], {"modality_preserved": False})
        self.assertEqual(p["failure_types"], ["modality_mismatch"])
        self.assertTrue(score_qa(p)["pass"])          # 점수는 4개 지표로만 정한다

    def test_resolve_languages_keeps_source_and_qa_apart(self):
        en_ctx = "Accuracy increased by 15 percentage points on the benchmark. " * 6
        r = resolve_languages({"q": "정확도는 얼마나 올랐나?", "a": "15%p", "context": en_ctx}, qa_language="ko")
        self.assertEqual((r["source_language"], r["qa_language"]), ("en", "ko"))
        self.assertEqual((r["source_language_from"], r["qa_language_from"]), ("inferred", "generation"))
        r = resolve_languages({"q": "How much?", "a": "15 points", "context": CTX, "source_language": "en"})
        self.assertEqual((r["source_language"], r["qa_language"]), ("en", "en"))
        self.assertEqual((r["source_language_from"], r["qa_language_from"]), ("metadata", "inferred"))


class PipelineV2Tests(unittest.TestCase):
    def test_results_align_with_original_indices(self):
        items = [qa(q="첫 번째 질문은 무엇인가?"), qa(a=""), qa(q="세 번째 질문은 무엇인가?")]
        model = FakeModel({"세 번째 질문은 무엇인가?": judge_json(10, 3, 10, 10)})
        out = run_v2_pipeline(items, "fake", judge=QAJudge("fake", judge_model=model), max_workers=2)
        self.assertEqual(out["metadata"]["eval_version"], "v2")
        r = out["qa_results"]
        self.assertEqual([x["qa_index"] for x in r], [0, 1, 2])
        self.assertTrue(r[0]["pass"])
        self.assertTrue(r[1]["skipped"])
        self.assertTrue(r[2]["hard_fail"])
        j = out["layers"]["judge"]
        self.assertEqual((j["evaluated_count"], j["pass_count"], j["hard_fail_count"]), (2, 1, 1))
        self.assertEqual(out["layers"]["validation"]["invalid"], 1)
        self.assertNotIn("valid_indices", out["layers"]["validation"])
        self.assertEqual(r[0]["language_policy"], "korean_native")
        self.assertEqual(j["by_language_policy"]["korean_native"]["judged"], 2)


class V2ReportTests(unittest.TestCase):
    def _out(self):
        items = [qa(q="첫 번째 질문은 무엇인가?"), qa(a=""), qa(q="세 번째 질문은 무엇인가?"), qa(q="네 번째 질문은 무엇인가?")]
        model = FakeModel({"세 번째 질문은 무엇인가?": judge_json(10, 3, 10, 10), "네 번째 질문은 무엇인가?": "garbage"})
        return items, run_v2_pipeline(items, "fake", judge=QAJudge("fake", judge_model=model), max_workers=2)

    def test_rows_keep_v1_keys_and_status(self):
        items, out = self._out()
        rep = build_v2_report(items, out)
        rows = rep["qa_preview"]
        self.assertEqual([r["v2_status"] for r in rows], ["pass", "skipped", "hard_fail", "error"])
        self.assertEqual([r["primary_failure"] for r in rows], [None, "syntax_error", "low_correctness", "evaluation_error"])
        self.assertEqual(rows[0]["rag_avg"], 1.0)
        self.assertTrue(rows[0]["pass"])
        s = rep["summary"]
        self.assertEqual((s["pass_count"], s["hard_fail_count"], s["evaluation_error_count"]), (1, 1, 1))
        self.assertIsNone(s["grade"])                       # 3개 중 1개 실패 → 33% > 20%
        self.assertEqual(s["grade_withheld"], "too_many_evaluation_errors")
        self.assertEqual(rep["layers"]["quality"]["qa_scores"], rows)
        self.assertEqual(rep["layers"]["rag"]["qa_scores"], [])

    def test_export_detail_reads_v2_rows_by_original_index(self):
        items, out = self._out()
        rep = build_v2_report(items, out)
        raw = [{"docId": "doc1", "text": CTX, "qa_list": [{"q": x["q"], "a": x["a"], "intent": "fact"} for x in items]}]
        detail = build_export_detail(raw, {"layers": {"quality": {"qa_scores": rep["layers"]["quality"]["qa_scores"]}}})
        self.assertEqual([d["v2_status"] for d in detail], ["pass", "skipped", "hard_fail", "error"])
        self.assertEqual(detail[2]["q"], "세 번째 질문은 무엇인가?")
        self.assertEqual(detail[2]["correctness"], 0.3)


class RunV2JobTests(unittest.TestCase):
    def test_job_completes_with_v2_layers_and_report(self):
        from backend.evaluators import pipeline, pipeline_v2
        from backend.evaluators.job_manager import EvaluationManager
        mgr = EvaluationManager()
        mgr.create_job("j1", "f.json")
        fake = lambda model: QAJudge("fake", judge_model=FakeModel({}))
        with mock.patch.object(pipeline_v2, "QAJudge", side_effect=fake), \
             mock.patch.object(pipeline, "is_supabase_available", return_value=False):
            pipeline._run_v2("j1", "f.json", [qa(), qa(q="두 번째 질문은 무엇인가?")], "fake", mgr, None,
                             {"generation_model": "g", "lang": "ko", "prompt_version": "v1", "source_doc": "d.pdf",
                              "hierarchy_h1": "", "hierarchy_h2": "", "hierarchy_h3": ""})
        job = mgr.jobs["j1"]
        self.assertEqual(job.status.value, "completed")
        self.assertEqual(set(job.layers_status), {"validation", "judge"})
        self.assertTrue(all(v["status"] == "completed" for v in job.layers_status.values()))
        rep = job.eval_report
        self.assertEqual(rep["metadata"]["eval_version"], "v2")
        self.assertEqual((rep["summary"]["pass_count"], rep["summary"]["grade"]), (2, "A+"))


class V1ErrorFlagTests(unittest.TestCase):
    """v1 점수는 그대로, 대체값이 쓰인 경우 error 표시가 남아야 한다."""

    def test_rag_parse_failure_is_flagged(self):
        ev = RAGTriadEvaluator.__new__(RAGTriadEvaluator)
        ev.judge_model = FakeModel({}, default="not json")
        _, out = _rag_worker((0, qa(), ev, "job"))
        self.assertEqual(out["groundedness"], 0.65)
        self.assertEqual(out["error"], "judge_parse_error")

    def test_rag_success_has_no_error(self):
        ev = RAGTriadEvaluator.__new__(RAGTriadEvaluator)
        ev.judge_model = FakeModel({}, default=json.dumps(
            {"relevance": 9, "groundedness": 9, "context_relevance": 9}))
        _, out = _rag_worker((0, qa(), ev, "job"))
        self.assertNotIn("error", out)

    def test_quality_empty_response_is_flagged(self):
        ev = QAQualityEvaluator.__new__(QAQualityEvaluator)
        ev.provider, ev.client = "google", None
        ev.judge_model = FakeModel({}, default="{}")
        _, out = _quality_worker((0, qa(), ev, "job"))
        self.assertEqual(out["completeness"], 0.5)
        self.assertEqual(out["error"], "judge_parse_error")


if __name__ == "__main__":
    unittest.main()
