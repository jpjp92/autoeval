"""English document policy: language detection, English headings, translation check.

Korean paths must keep their previous behaviour (language defaults to "ko").
Run: python -m unittest backend.tests.test_english_chunking
"""

import asyncio
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingestion import llm_chunker  # noqa: E402
from generators.prompts import build_system_prompt  # noqa: E402
from ingestion.language import build_word_counts, detect_language, normalize_english_text  # noqa: E402
from ingestion.parsers import is_toc_chunk  # noqa: E402
from ingestion.prompts import build_hierarchy_prompt  # noqa: E402
from ingestion.tagging import _is_admin_anchor  # noqa: E402
from ingestion.llm_chunker import find_translated_chunks, select_prompts  # noqa: E402
from ingestion.parsers import build_sections, detect_heading, detect_section_level  # noqa: E402

EN_BODY = (
    "The Transformer relies entirely on attention to draw global dependencies between input and output. "
    "We train on the WMT 2014 English-German dataset with 4.5 million sentence pairs. "
) * 3
KO_BODY = (
    "본 연구는 광역 정전을 방지하기 위한 감시 제어 시스템의 구조를 제안한다. "
    "제안 시스템은 Wide Area Monitoring and Control System(WAMS)을 기반으로 한다. "
) * 3


class DetectLanguageTests(unittest.TestCase):
    def test_english_document(self):
        self.assertEqual(detect_language([EN_BODY])["language"], "en")

    def test_korean_document_with_english_terms_stays_ko(self):
        self.assertEqual(detect_language([KO_BODY])["language"], "ko")

    def test_table_marker_alone_does_not_make_english_korean(self):
        self.assertEqual(detect_language(["[표]\n| Model | BLEU |", EN_BODY])["language"], "en")

    def test_too_little_text_keeps_default(self):
        self.assertEqual(detect_language(["Short English title"])["language"], "ko")


class EnglishHeadingTests(unittest.TestCase):
    def test_numbered_and_named_headings(self):
        cases = {
            "1 Introduction": 1,
            "3.1 Pre-training BERT": 2,
            "3.2.1 Scaled Dot-Product Attention": 3,
            "A.2 Details of SQuAD": 2,
            "Appendix A": 1,
            "Abstract": 1,
            "References": 1,
        }
        for text, level in cases.items():
            with self.subTest(text=text):
                self.assertEqual(detect_heading(text, 11.0, 10.0, "en"), text)
                self.assertEqual(detect_section_level(text, "en"), level)

    def test_margin_stamp_and_sentences_are_not_headings(self):
        # The side stamp uses a large font, so it would pass the font-boost rule without the filter.
        self.assertIsNone(detect_heading("arXiv:1706.03762v7 [cs.CL] 2 Aug 2023", 20.0, 10.0, "en"))
        for text in ["We use 6 layers in the encoder.", "1 Introduction."]:
            with self.subTest(text=text):
                self.assertIsNone(detect_heading(text, 10.0, 10.0, "en"))

    def test_korean_default_is_unchanged(self):
        # ko: "1 Introduction" is not a heading by pattern (no font boost), as before.
        self.assertIsNone(detect_heading("1 Introduction", 11.0, 10.0))
        self.assertEqual(detect_heading("제2조(정의)", 11.0, 10.0), "제2조(정의)")
        self.assertEqual(detect_section_level("1.1 연구 배경"), 2)

    def test_build_sections_splits_english_paper(self):
        blocks = [
            {"text": "Abstract", "font_size": 11, "page": 1},
            {"text": EN_BODY, "font_size": 10, "page": 1},
            {"text": "1 Introduction", "font_size": 11, "page": 1},
            {"text": EN_BODY, "font_size": 10, "page": 1},
            {"text": "arXiv:1706.03762v7 [cs.CL] 2 Aug 2023", "font_size": 20, "page": 1},
            {"text": EN_BODY, "font_size": 10, "page": 2},
        ]
        headings = [s["heading"] for s in build_sections(blocks, language="en")]
        self.assertEqual(headings, ["Abstract", "1 Introduction"])
        # ko keeps the previous grouping for the same blocks
        self.assertEqual(
            [s["heading"] for s in build_sections(blocks)],
            [s["heading"] for s in build_sections(blocks, language="ko")],
        )


class TranslationCheckTests(unittest.TestCase):
    new_blocks = [{"index": 0, "page": 1, "text": EN_BODY}, {"index": 1, "page": 1, "text": KO_BODY}]

    def test_flags_translated_english_chunk(self):
        chunks = [{"text": "트랜스포머는 어텐션에만 의존한다.", "section_title": "Model", "source_blocks": [0]}]
        self.assertEqual(find_translated_chunks(chunks, self.new_blocks), [0])

    def test_flags_korean_section_title(self):
        chunks = [{"text": EN_BODY, "section_title": "모델 구조", "source_blocks": [0]}]
        self.assertEqual(find_translated_chunks(chunks, self.new_blocks), [0])

    def test_keeps_english_and_table_marker(self):
        chunks = [{"text": "[표] BLEU scores\n" + EN_BODY, "section_title": "Results", "source_blocks": [0]}]
        self.assertEqual(find_translated_chunks(chunks, self.new_blocks), [])

    def test_korean_source_is_not_flagged(self):
        chunks = [{"text": KO_BODY, "section_title": "연구 배경", "source_blocks": [1]}]
        self.assertEqual(find_translated_chunks(chunks, self.new_blocks), [])

    def test_prompt_selection(self):
        self.assertIs(select_prompts("ko", docx=False)[0], llm_chunker.SYSTEM_PROMPT)
        self.assertIs(select_prompts("ko", docx=True)[0], llm_chunker.DOCX_SYSTEM_PROMPT)
        self.assertIs(select_prompts("en", docx=False)[0], llm_chunker.SYSTEM_PROMPT_EN)
        self.assertIs(select_prompts("en", docx=True)[0], llm_chunker.DOCX_SYSTEM_PROMPT_EN)
        self.assertIn("Do NOT translate", llm_chunker.SYSTEM_PROMPT_EN)


class ProcessBatchRetryTests(unittest.TestCase):
    """_process_batch retries once on translation, then falls back to the source blocks."""

    def run_batch(self, responses, language="en"):
        calls = []

        async def fake_call(prompt, client, model, batch_size):
            calls.append(prompt)
            return responses[min(len(calls) - 1, len(responses) - 1)]

        original = llm_chunker._call_gemini
        llm_chunker._call_gemini = fake_call
        try:
            blocks = [{"index": 0, "page": 1, "text": EN_BODY}]
            system, user = select_prompts(language, docx=False)
            _, chunks = asyncio.run(llm_chunker._process_batch(
                asyncio.Semaphore(1), 1, [], blocks, None, "m", 30,
                system_prompt=system, user_template=user, language=language,
            ))
        finally:
            llm_chunker._call_gemini = original
        return calls, chunks

    translated = json.dumps([{"text": "트랜스포머는 어텐션에만 의존한다.", "section_title": "모델", "source_blocks": [0]}])
    english = json.dumps([{"text": EN_BODY, "section_title": "Model", "source_blocks": [0]}])

    def test_retry_then_success(self):
        calls, chunks = self.run_batch([self.translated, self.english])
        self.assertEqual(len(calls), 2)
        self.assertEqual(chunks[0]["section_title"], "Model")
        self.assertEqual(chunks[0]["llm_retries"], 1)

    def test_persistent_translation_falls_back_to_source(self):
        calls, chunks = self.run_batch([self.translated])
        self.assertEqual(len(calls), 2)
        self.assertTrue(chunks[0]["fallback"])
        self.assertEqual(chunks[0]["fallback_reason"], "translated")
        self.assertEqual(chunks[0]["text"], EN_BODY)

    def test_korean_batches_are_not_checked(self):
        calls, chunks = self.run_batch([self.translated], language="ko")
        self.assertEqual(len(calls), 1)
        self.assertNotIn("fallback", chunks[0])



class EnglishNormalizationTests(unittest.TestCase):
    counts = build_word_counts(["additional pre-trained sequence models are aligned", "fine-tune"])

    def test_ligatures(self):
        self.assertEqual(normalize_english_text("\ufb01ne-tune \ufb02ow e\ufb00ect"), "fine-tune flow effect")

    def test_line_break_hyphen_rules(self):
        cases = {
            "addi- tional": "additional",          # joined form exists
            "pre- trained": "pre-trained",         # hyphenated form exists
            "sequence- aligned": "sequence-aligned",  # both parts are words
            "espe- cially": "especially",          # unknown → join
            "addi-\ntional": "additional",         # real line break
            "fine-tune": "fine-tune",              # no space after hyphen → untouched
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalize_english_text(raw, self.counts), expected)

    def test_fragments_are_not_counted_as_words(self):
        counts = build_word_counts(["com- bined", "com- pute"])
        self.assertEqual(counts["com"], 0)


class EnglishFilterTests(unittest.TestCase):
    def test_admin_anchor_english(self):
        cases = {
            "The proposed model improves accuracy by 15%.": False,
            "Methods and Experimental Setup": False,
            "2026-01-01, 2026-02-01, 2026-03-01": True,
            "Accuracy: 94.2%, Recall: 91.5%": False,
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(_is_admin_anchor(text, "en"), expected)

    def test_admin_anchor_korean_default_unchanged(self):
        # Previous rule: low Hangul ratio → admin. Still true for ko.
        self.assertTrue(_is_admin_anchor("The proposed model improves accuracy by 15%."))

    def test_english_toc(self):
        toc = "Contents\n" + "\n".join(f"{i}.{j} Section title {i}{j}" for i in range(1, 4) for j in range(1, 3))
        self.assertTrue(is_toc_chunk(toc, "en"))
        self.assertFalse(is_toc_chunk(toc))  # ko: no "목차" keyword, as before

    def test_english_body_with_section_numbers_is_not_toc(self):
        body = " ".join(
            f"In Section {i}.{j} we report that the model improves the score by {i}.{j} points over the baseline."
            for i in range(1, 4) for j in range(1, 4)
        )
        self.assertFalse(is_toc_chunk(body, "en"))


class QAOutputLanguageTests(unittest.TestCase):
    profile = {"domain": "AI 연구 논문", "target_audience": "연구자", "key_terms": ["BERT"], "tone": "격식체"}

    def test_korean_prompt_unchanged(self):
        prompt = build_system_prompt(self.profile, "ko")
        self.assertNotIn("<output_language>", prompt)
        self.assertEqual(prompt, build_system_prompt(self.profile))

    def test_english_prompt_overrides_language(self):
        prompt = build_system_prompt(self.profile, "en")
        self.assertTrue(prompt.startswith(build_system_prompt(self.profile, "ko")))
        self.assertIn("Write every question and answer in English", prompt)

    def test_static_english_prompt_no_longer_forces_korean(self):
        from generators.prompts_en import SYSTEM_PROMPT_EN_V1
        self.assertNotIn("in Korean", SYSTEM_PROMPT_EN_V1)



class TaxonomyLanguageTests(unittest.TestCase):
    def test_korean_is_default(self):
        self.assertEqual(build_hierarchy_prompt("ctx", "2~3"), build_hierarchy_prompt("ctx", "2~3", "ko"))
        self.assertIn("All taxonomy names in Korean", build_hierarchy_prompt("ctx", "2~3"))

    def test_english_taxonomy_prompt(self):
        prompt = build_hierarchy_prompt("ctx", "2~3", "en")
        self.assertIn("All taxonomy names in English", prompt)
        self.assertNotIn("in Korean", prompt)
        self.assertIn("2~3 H2", prompt)


if __name__ == "__main__":
    unittest.main()
