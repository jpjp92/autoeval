"""xlsx / csv ingestion: workbooks are built with openpyxl in the test.

Run: python -m unittest backend.tests.test_spreadsheet
"""

import datetime as dt
import io
import os
import sys
import unittest

from openpyxl import Workbook

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingestion import spreadsheet  # noqa: E402
from ingestion.chunker import ingest_with_table_chunking  # noqa: E402
from ingestion.parsers import extract_text_by_page  # noqa: E402
from ingestion.spreadsheet import format_value  # noqa: E402


def _xlsx(build) -> bytes:
    wb = Workbook()
    build(wb)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _tables(pages):
    return [b["text"] for p in pages for b in p["blocks"] if b["text"].startswith("[표]")]


class FormatValueTests(unittest.TestCase):
    def test_number_formats(self):
        cases = [
            (0.0014, "0.00%", "0.14%"),
            (-0.0245, "0.00%", "-2.45%"),
            (0.5, "0%", "50%"),
            (12345, "#,##0", "12,345"),
            (55010.25, "#,##0.0", "55,010.3"),   # Excel rounds half up
            (2.675, "0.00", "2.68"),
            (1000.0, "General", "1000"),
            (0.1 + 0.2, "General", "0.3"),
            (dt.datetime(2025, 11, 17), "yyyy-mm-dd", "2025-11-17"),
            (dt.datetime(2025, 11, 17, 9, 30), "General", "2025-11-17 09:30"),
            (True, "General", "TRUE"),
            (None, "General", ""),
            ("  서울\n강남 ", "General", "서울 강남"),
        ]
        for value, fmt, expected in cases:
            with self.subTest(value=value, fmt=fmt):
                self.assertEqual(format_value(value, fmt), expected)


class XlsxExtractTests(unittest.TestCase):
    def test_sheets_regions_merges_and_captions(self):
        def build(wb):
            ws = wb.active
            ws.title = "매매가격"
            ws["A1"] = "시도별 매매가격 변동률"
            ws.merge_cells("A3:A4"); ws["A3"] = "지역"
            ws.merge_cells("B3:C3"); ws["B3"] = "누계"
            ws["B4"], ws["C4"] = "'24년", "'25년"
            for i, (name, a, b) in enumerate([("서울", 0.0431, 0.0749), ("부산", -0.0245, -0.013)], 5):
                ws[f"A{i}"] = name
                ws[f"B{i}"], ws[f"C{i}"] = a, b
                ws[f"B{i}"].number_format = ws[f"C{i}"].number_format = "0.00%"
            ws["E3"], ws["F3"] = "기준일", "거래량"          # side table after an empty column
            ws["E4"], ws["F4"] = dt.date(2025, 11, 17), 13002
            ws["E4"].number_format, ws["F4"].number_format = "yyyy-mm-dd", "#,##0"
            ws["E5"], ws["F5"] = dt.date(2025, 11, 10), 12345
            ws["E5"].number_format, ws["F5"].number_format = "yyyy-mm-dd", "#,##0"
            hidden = wb.create_sheet("비공개")
            hidden["A1"], hidden["B1"], hidden["A2"], hidden["B2"] = "a", "b", "c", "d"
            hidden.sheet_state = "hidden"

        pages = extract_text_by_page(_xlsx(build), "sample.xlsx")
        self.assertEqual([p["sheet"] for p in pages], ["매매가격"])   # hidden sheet skipped
        main, side = _tables(pages)
        self.assertEqual(main.split("\n"), [
            "[표] 매매가격 · 시도별 매매가격 변동률",
            "| 지역 | 누계 | 누계 |",
            "| --- | --- | --- |",
            "|  | '24년 | '25년 |",          # second header row, vertical merge left empty
            "| 서울 | 4.31% | 7.49% |",
            "| 부산 | -2.45% | -1.30% |",
        ])
        self.assertEqual(side.split("\n")[1:], [
            "| 기준일 | 거래량 |",
            "| --- | --- |",
            "| 2025-11-17 | 13,002 |",
            "| 2025-11-10 | 12,345 |",
        ])   # no empty rows borrowed from the left table

    def test_formula_without_saved_value_is_empty(self):
        def build(wb):
            ws = wb.active
            ws.append(["항목", "값"]); ws.append(["a", 1]); ws.append(["b", 2]); ws.append(["합계", "=SUM(B2:B3)"])
        with self.assertLogs("autoeval.ingestion.spreadsheet", level="WARNING") as logs:
            pages = extract_text_by_page(_xlsx(build), "f.xlsx")
        self.assertIn("| 합계 |  |", _tables(pages)[0])
        self.assertTrue(any("formula" in m for m in logs.output))

    def test_row_limit(self):
        def build(wb):
            ws = wb.active
            ws.append(["n", "v"])
            for i in range(30):
                ws.append([i, i * 2])
        original = spreadsheet.MAX_ROWS_PER_SHEET
        spreadsheet.MAX_ROWS_PER_SHEET = 11
        try:
            pages = extract_text_by_page(_xlsx(build), "big.xlsx")
        finally:
            spreadsheet.MAX_ROWS_PER_SHEET = original
        self.assertEqual(pages[0]["truncated_rows"], 20)
        data_rows = _tables(pages)[0].split("\n")[3:]   # after title, header, separator
        self.assertEqual(data_rows, [f"| {i} | {i * 2} |" for i in range(10)])   # 11 rows read = header + 10

    def test_xls_is_rejected_with_message(self):
        with self.assertRaisesRegex(ValueError, r"\.xlsx로 저장"):
            extract_text_by_page(b"\xd0\xcf\x11\xe0", "old.xls")


class CsvExtractTests(unittest.TestCase):
    def test_cp949_csv(self):
        data = "지역,매매\n서울,0.20%\n부산,0.05%\n".encode("cp949")
        pages = extract_text_by_page(data, "시도.csv")
        self.assertEqual(_tables(pages)[0].split("\n"), [
            "[표] 시도", "| 지역 | 매매 |", "| --- | --- |", "| 서울 | 0.20% |", "| 부산 | 0.05% |",
        ])


class TableChunkingTests(unittest.TestCase):
    def test_large_sheet_parts_keep_label_and_all_rows(self):
        def build(wb):
            ws = wb.active
            ws.title = "로그"
            ws.append(["일자", "매출"])
            for i in range(300):
                ws.append([f"d{i}", 1000 + i])
        pages = extract_text_by_page(_xlsx(build), "log.xlsx")
        blocks = [b for p in pages for b in p["blocks"]]
        chunks = ingest_with_table_chunking("log.xlsx", blocks)
        n = len(chunks)
        self.assertGreater(n, 1)
        for k, c in enumerate(chunks, 1):
            self.assertTrue(c["text"].startswith(f"[표] 로그 ({k}/{n})\n| 일자 | 매출 |\n| --- | --- |\n"))
            self.assertEqual(c["section_title"], f"로그 ({k}/{n})")
            self.assertEqual(c["chunk_type"], "table")
            self.assertLessEqual(len(c["text"]), 800)
        rows = [l for c in chunks for l in c["text"].split("\n")[3:]]
        self.assertEqual(rows, [f"| d{i} | {1000 + i} |" for i in range(300)])


if __name__ == "__main__":
    unittest.main()
