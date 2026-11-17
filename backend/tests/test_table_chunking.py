"""Large PDF tables: stacked cells are exploded into rows, big tables become verbatim chunks.

Cases come from test/!251120(보도자료)_주간아파트가격동향(20251117기준).pdf (pages 9, 11).
Run: python -m unittest backend.tests.test_table_chunking
"""

import io
import os
import sys
import unittest

import docx
import fitz

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingestion.chunker import _merge_by_source_order, _split_verbatim_tables  # noqa: E402
from ingestion.parsers import (  # noqa: E402
    _explode_stacked_rows,
    extract_text_by_page,
    format_table_as_text,
    split_large_table_text,
)

INNER_ROWS = [("구", "변동률"), ("강남", "0.25"), ("송파", "0.31")]


def _nested_docx() -> bytes:
    doc = docx.Document()
    doc.add_paragraph("중첩 표 테스트 문서입니다.")
    outer = doc.add_table(rows=2, cols=2)
    outer.cell(0, 0).text, outer.cell(0, 1).text = "구분", "세부 내용"
    outer.cell(1, 0).text = "서울"
    cell = outer.cell(1, 1)
    cell.text = "구별 변동률"
    inner = cell.add_table(rows=3, cols=2)
    for r, (a, b) in enumerate(INNER_ROWS):
        inner.cell(r, 0).text, inner.cell(r, 1).text = a, b
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _nested_pdf(wrapper: bool = False) -> bytes:
    """Outer 2x2 grid with a 3x2 table in the lower-right cell.
    wrapper=True draws a 1x1 frame around the inner table only (layout box, no own text)."""
    doc = fitz.open()
    pg = doc.new_page()

    def txt(x, y, s):
        pg.insert_text((x, y), s, fontname="korea", fontsize=10)

    if wrapper:
        for y in (150, 300):
            pg.draw_line((172, y), (472, y))
        for x in (172, 472):
            pg.draw_line((x, 150), (x, 300))
    else:
        for y in (120, 145, 300):
            pg.draw_line((72, y), (472, y))
        for x in (72, 172, 472):
            pg.draw_line((x, 120), (x, 300))
        txt(80, 137, "구분"); txt(180, 137, "세부 내용"); txt(80, 220, "서울"); txt(180, 165, "구별 변동률")
    for y in (180, 210, 240, 270):
        pg.draw_line((190, y), (450, y))
    for x in (190, 320, 450):
        pg.draw_line((x, 180), (x, 270))
    for r, (a, b) in enumerate(INNER_ROWS):
        txt(198, 199 + 30 * r, a); txt(328, 199 + 30 * r, b)
    return doc.tobytes()


def _block_texts(content: bytes, filename: str) -> list:
    return [b["text"] for p in extract_text_by_page(content, filename) for b in p.get("blocks", [])]


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



class NestedTableTests(unittest.TestCase):
    label = "[표] 서울 · 구별 변동률 (하위 표)"

    def assert_nested(self, texts):
        outer = [t for t in texts if "구분" in t]
        inner = [t for t in texts if t.startswith(self.label)]
        self.assertEqual(len(outer), 1)
        self.assertIn("| 서울 | 구별 변동률 [하위 표] |", outer[0])
        self.assertNotIn("강남", outer[0])           # not duplicated into the outer cell
        self.assertEqual(len(inner), 1)
        self.assertIn("| 강남 | 0.25 |", inner[0])   # and not lost
        self.assertIn("| 송파 | 0.31 |", inner[0])
        self.assertLess(texts.index(outer[0]), texts.index(inner[0]))

    def test_docx_inner_table_is_extracted(self):
        self.assert_nested(_block_texts(_nested_docx(), "nested.docx"))

    def test_pdf_inner_table_is_not_duplicated(self):
        self.assert_nested(_block_texts(_nested_pdf(), "nested.pdf"))

    def test_pdf_layout_wrapper_is_dropped(self):
        texts = _block_texts(_nested_pdf(wrapper=True), "wrapper.pdf")
        tables = [t for t in texts if t.startswith("[표]")]
        self.assertEqual(len(tables), 1)
        self.assertTrue(tables[0].startswith("[표]\n| 구 | 변동률 |"))   # inner kept as a plain table
        self.assertNotIn("하위 표", tables[0])


class DocxLargeTableTests(unittest.TestCase):
    def test_docx_style_table_is_split_with_header(self):
        rows = ["| 지역 | 값 |"] + [f"| 지역{i} | {i}.5 |" for i in range(80)]
        text = "\n\n".join(rows)   # DOCX rows are separated by blank lines
        parts = split_large_table_text(text, max_chars=300)
        self.assertGreater(len(parts), 1)
        for p in parts:
            self.assertIn("\n| 지역 | 값 |\n| --- | --- |\n", p)
        body = [l for p in parts for l in p.split("\n")[3:]]
        self.assertEqual(body, rows[1:])

    def test_small_docx_table_is_unchanged(self):
        text = "| a | b |\n\n| 1 | 2 |"
        self.assertEqual(split_large_table_text(text), [text])


if __name__ == "__main__":
    unittest.main()
