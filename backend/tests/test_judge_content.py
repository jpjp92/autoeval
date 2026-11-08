"""Judge responses may contain text blocks rather than a plain string."""

import json
import unittest

from langchain_core.messages import AIMessage

from backend.evaluators.qa_quality import QAQualityEvaluator
from backend.evaluators.rag_triad import RAGTriadEvaluator


class StaticJudge:
    def __init__(self, content):
        self.message = AIMessage(content=content)

    def invoke(self, _prompt):
        return self.message


def response_forms(payload):
    text = json.dumps(payload)
    return [text, [
        {"type": "reasoning", "reasoning": "Not part of the JSON response."},
        {"type": "text", "text": text},
    ]]


class JudgeContentTests(unittest.TestCase):
    def test_quality_reads_json_from_plain_text_and_content_blocks(self):
        payload = {"completeness": 9, "coverage": 0.9, "missing_aspects": []}
        for content in response_forms(payload):
            with self.subTest(content_type=type(content).__name__):
                evaluator = QAQualityEvaluator.__new__(QAQualityEvaluator)
                evaluator.provider = "google"
                evaluator.client = None
                evaluator.judge_model = StaticJudge(content)
                self.assertEqual(json.loads(evaluator._call_llm_combined("Synthetic QA")), payload)

    def test_rag_scores_do_not_silently_fall_back_for_content_blocks(self):
        payload = {
            "relevance": 10, "relevance_reason": "질문에 답함",
            "groundedness": 9, "groundedness_reason": "문맥에서 확인됨",
            "context_relevance": 8, "context_relevance_reason": "문맥이 적절함",
        }
        for content in response_forms(payload):
            with self.subTest(content_type=type(content).__name__):
                evaluator = RAGTriadEvaluator.__new__(RAGTriadEvaluator)
                evaluator.judge_model = StaticJudge(content)
                result = evaluator.evaluate_all_with_reasons("Question", "Answer", "Context")
                self.assertEqual(result["relevance"], 1.0)
                self.assertEqual(result["groundedness"], 0.9)
                self.assertEqual(result["context_relevance"], 0.8)
                self.assertEqual(result["groundedness_reason"], payload["groundedness_reason"])


if __name__ == "__main__":
    unittest.main()
