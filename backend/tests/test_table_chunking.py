"""Large PDF tables: stacked cells are exploded into rows, big tables become verbatim chunks.

Cases come from test/!251120(보도자료)_주간아파트가격동향(20251117기준).pdf (pages 9, 11).
Run: python -m unittest backend.tests.test_table_chunking
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingestion.chunker import _merge_by_source_order, _split_verbatim_tables  # noqa: E402
from ingestion.parsers import (  # noqa: E402
    _explode_stacked_rows,
    format_table_as_text,
    split_large_table_text,
)


class ExplodeStackedRowsTests(unittest.TestCase):
    def test_equal_line_counts_become_rows(self):
        rows = [["경기", "수원\n수원 장안\n수원 권선", "2.40\n1.62\n0.96", "2.20\n1.52\n0.82"]]
        self.assertEqual(_explode_stacked_rows(rows), [
            ["경기", "수원", "2.40", "2.20"],
            [None, "수원 장안", "1.62", "1.52"],
            [None, "수원 권선", "0.96", "0.82"],
        ])

    def test_names_split_over_following_rows(self):
        # PyMuPDF put 4 names with 6 values, and the remaining 2 names in the next row.
        rows = [
            [None, "부천\n부천 원미\n부천 소사\n부천 오정", "1\n2\n3\n4\n5\n6", "a\nb\nc\nd\ne\nf"],
            [None, "안산\n안산 상록", None, None],
        ]
        out = _explode_stacked_rows(rows)
        self.assertEqual([r[1] for r in out], ["부천", "부천 원미", "부천 소사", "부천 오정", "안산", "안산 상록"])
        self.assertEqual([r[2] for r in out], ["1", "2", "3", "4", "5", "6"])

    def test_single_name_with_names_in_following_rows(self):
        # Page 9: '인 천' row holds the values of 인천~충남; the names follow in value-less rows.
        rows = [
            ["인 천", "1.72\n-2.45\n-4.20", "-0.87\n-1.30\n-3.68"],
            ["부 산", None, None],
            ["대 구", None, None],
            ["전 북", "0.53", "1.08"],
        ]
        self.assertEqual(_explode_stacked_rows(rows), [
            ["인 천", "1.72", "-0.87"],
            ["부 산", "-2.45", "-1.30"],
            ["대 구", "-4.20", "-3.68"],
            ["전 북", "0.53", "1.08"],
        ])

    def test_header_line_break_is_kept(self):
        rows = [[None, "‘24년", "‘25년", "10.13\n(2주 누계)", "10.20"]]
        self.assertEqual(_explode_stacked_rows(rows), rows)

    def test_unmatched_counts_keep_original_row(self):
        rows = [["A\nB", "1\n2\n3", "x\ny\nz"], ["C", "9", "9"]]
        self.assertEqual(_explode_stacked_rows(rows), rows)

    def test_no_forward_fill_duplicates(self):
        table = [
            ["지역", "누계"],
            ["인 천", "1.72\n-2.45"],
            ["부 산", None],
        ]
        text = format_table_as_text(table)
        self.assertIn("| 부 산 | -2.45 |", text)
        self.assertNotIn("| 부 산 | 1.72 |", text)


class SplitLargeTableTests(unittest.TestCase):
    header = "| 지역 | 누계 | 11.17 |\n| --- | --- | --- |\n|  | ‘24년 | 주간 |"

    def table(self, n_rows):
        body = "\n".join(f"| 지역{i} | {i}.11 | {i}.22 |" for i in range(n_rows))
        return "[표]\n" + self.header + "\n" + body

    def test_small_table_is_unchanged(self):
        t = self.table(3)
        self.assertEqual(split_large_table_text(t), [t])

    def test_large_table_parts_repeat_both_header_rows(self):
        parts = split_large_table_text(self.table(60), max_chars=400)
        self.assertGreater(len(parts), 1)
        for k, p in enumerate(parts, 1):
            self.assertTrue(p.startswith(f"[표] ({k}/{len(parts)})\n" + self.header))
            self.assertLessEqual(len(p), 400)
        body_rows = [l for p in parts for l in p.split("\n")[4:]]
        self.assertEqual(body_rows, self.table(60).split("\n")[4:])  # no row lost or duplicated

    def test_non_table_text_is_unchanged(self):
        self.assertEqual(split_large_table_text("본문 " * 400), ["본문 " * 400])


class VerbatimTableChunkTests(unittest.TestCase):
    def test_big_tables_skip_llm_and_keep_order(self):
        big = "[표]\n| a | b |\n| --- | --- |\n" + "\n".join(f"| r{i} | {i}.5 |" for i in range(120))
        blocks = [
            {"page": 1, "text": "[ ]매매가격 변동률"},
            {"page": 1, "text": big},
            {"page": 2, "text": "다음 본문"},
        ]
        llm_blocks, table_chunks = _split_verbatim_tables(blocks)
        self.assertEqual([b["text"] for b in llm_blocks], ["[ ]매매가격 변동률", "다음 본문"])
        self.assertGreater(len(table_chunks), 1)
        self.assertTrue(table_chunks[0]["section_title"].startswith("매매가격 변동률 (1/"))
        indices = [b["index"] for b in llm_blocks] + [c["source_blocks"][0] for c in table_chunks]
        self.assertEqual(sorted(indices), list(range(len(indices))))  # one shared index space

        # LLM output for caption and body, merged back around the table chunks
        llm_chunks = [
            {"text": "caption", "source_blocks": [llm_blocks[0]["index"]]},
            {"text": "body", "source_blocks": [llm_blocks[1]["index"]]},
        ]
        merged = _merge_by_source_order(llm_chunks, table_chunks)
        self.assertEqual(merged[0]["text"], "caption")
        self.assertEqual(merged[-1]["text"], "body")
        self.assertEqual([c["chunk_index"] for c in merged], list(range(len(merged))))


if __name__ == "__main__":
    unittest.main()
