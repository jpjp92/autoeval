import os
import sys
import unittest
from unittest import mock

import fitz

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingestion import parsers  # noqa: E402


def _pdf(n_pages: int) -> bytes:
    doc = fitz.open()
    for i in range(n_pages):
        page = doc.new_page()
        page.insert_text((72, 200), f"본문 {i + 1}쪽 내용입니다. Page text {i + 1}.", fontname="helv")
        page.draw_line((100, 300), (100, 300))  # 크기 0 선
    data = doc.tobytes()
    doc.close()
    return data


class PdfWorkersTest(unittest.TestCase):
    def test_env_and_small_docs(self):
        with mock.patch.dict(os.environ, {"PDF_EXTRACT_WORKERS": "3"}):
            self.assertEqual(parsers._pdf_workers(10), 3)
            self.assertEqual(parsers._pdf_workers(2), 1)   # 쪽이 적으면 순차
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(parsers._pdf_workers(10), 1)  # 기본은 순차
        with mock.patch.dict(os.environ, {"PDF_EXTRACT_WORKERS": "abc"}):
            self.assertEqual(parsers._pdf_workers(10), 1)

    def test_degenerate_paths_removed(self):
        doc = fitz.open(stream=_pdf(1), filetype="pdf")
        self.assertEqual(parsers._table_paths(doc[0]), [])
        doc.close()

    def test_parallel_matches_sequential(self):
        data = _pdf(5)
        progress = []
        with mock.patch.dict(os.environ, {"PDF_EXTRACT_WORKERS": "1"}):
            seq = parsers.extract_text_by_page(data, "a.pdf", lambda d, t: progress.append((d, t)))
        with mock.patch.dict(os.environ, {"PDF_EXTRACT_WORKERS": "2"}):
            par = parsers.extract_text_by_page(data, "a.pdf")
        self.assertEqual(seq, par)
        self.assertTrue(seq)  # 1~2쪽은 짧아서 목차 판정으로 빠질 수 있다
        self.assertEqual([r["page"] for r in seq], sorted(r["page"] for r in seq))
        self.assertEqual(progress[-1], (5, 5))


if __name__ == "__main__":
    unittest.main()
