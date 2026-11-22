"""문서 처리 모델 교체(2.5 Flash → 3.5 Flash-Lite) 회귀 테스트.
기획: docs/Plan/PLAN_261122_DOC_MODEL_MIGRATION.md"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config.models import DOCUMENT_MODEL, MODEL_CONFIG, no_thinking_config  # noqa: E402
from ingestion import llm_chunker  # noqa: E402


class DocumentModelTest(unittest.TestCase):
    def test_default_is_35_flash_lite(self):
        self.assertEqual(DOCUMENT_MODEL, "gemini-3.5-flash-lite")
        if not os.getenv("DOCUMENT_MODEL_ID"):
            self.assertEqual(MODEL_CONFIG[DOCUMENT_MODEL]["model_id"], "gemini-3.5-flash-lite")
            self.assertEqual(llm_chunker.DEFAULT_MODEL, "gemini-3.5-flash-lite")

    def test_gemini3_uses_thinking_level(self):
        # 3.x에 thinking_budget=0을 보내면 400 INVALID_ARGUMENT
        cfg = no_thinking_config("gemini-3.5-flash-lite")
        self.assertIsNone(cfg.thinking_budget)
        self.assertEqual(str(cfg.thinking_level).split(".")[-1].lower(), "minimal")

    def test_gemini2_keeps_budget_zero(self):
        cfg = no_thinking_config("gemini-2.5-flash")
        self.assertEqual(cfg.thinking_budget, 0)
        self.assertIsNone(cfg.thinking_level)

    def test_chunk_config_follows_model(self):
        self.assertIsNone(llm_chunker._gen_config(30, "gemini-3.5-flash-lite").thinking_config.thinking_budget)
        self.assertEqual(llm_chunker._gen_config(30, "gemini-2.5-flash").thinking_config.thinking_budget, 0)

    def test_chunk_seed_fixed(self):
        # seed가 없으면 3.5 Flash-Lite 청크 수가 실행마다 흔들린다
        self.assertEqual(llm_chunker._gen_config(30).seed, llm_chunker.CHUNK_SEED)


if __name__ == "__main__":
    unittest.main()
