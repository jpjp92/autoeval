import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingestion import llm_chunker  # noqa: E402


class _Resp:
    text = " [] "


class _Models:
    def __init__(self, errors):
        self.errors = list(errors)
        self.calls = 0

    async def generate_content(self, **kw):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return _Resp()


class _Client:
    def __init__(self, errors=()):
        self.aio = mock.Mock()
        self.aio.models = _Models(errors)


class ParallelParamsTest(unittest.TestCase):
    def test_defaults(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(llm_chunker.recommend_params(15)["parallel"], 8)
            self.assertEqual(llm_chunker.recommend_params(80)["parallel"], 10)
            self.assertEqual(llm_chunker.recommend_params_docx(40)["parallel"], 8)

    def test_env_override(self):
        with mock.patch.dict(os.environ, {"LLM_CHUNK_PARALLEL": "4"}):
            self.assertEqual(llm_chunker.recommend_params(150)["parallel"], 4)
            self.assertEqual(llm_chunker.recommend_params_docx(400)["parallel"], 4)
        with mock.patch.dict(os.environ, {"LLM_CHUNK_PARALLEL": "x"}):
            self.assertEqual(llm_chunker.recommend_params(15)["parallel"], 8)


class RateLimitRetryTest(unittest.TestCase):
    def setUp(self):
        self.sleep = mock.patch.object(llm_chunker.asyncio, "sleep", new=mock.AsyncMock())
        self.sleep.start()

    def tearDown(self):
        self.sleep.stop()

    def test_retry_then_success(self):
        c = _Client([Exception("429 RESOURCE_EXHAUSTED"), Exception("429")])
        out = asyncio.run(llm_chunker._call_gemini("p", c, "m", 30))
        self.assertEqual(out, "[]")
        self.assertEqual(c.aio.models.calls, 3)

    def test_gives_up_after_retries(self):
        c = _Client([Exception("429")] * 4)
        with self.assertRaises(Exception):
            asyncio.run(llm_chunker._call_gemini("p", c, "m", 30))
        self.assertEqual(c.aio.models.calls, 4)

    def test_other_errors_not_retried(self):
        c = _Client([ValueError("bad request")])
        with self.assertRaises(ValueError):
            asyncio.run(llm_chunker._call_gemini("p", c, "m", 30))
        self.assertEqual(c.aio.models.calls, 1)


if __name__ == "__main__":
    unittest.main()
