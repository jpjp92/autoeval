"""작업 ID 형식 (TX-YYMMDD-XXXXXX, 평가는 -E번호).

Run: python -m unittest backend.tests.test_job_ids
"""
import re
import unittest
from datetime import datetime

from backend.job_ids import ALPHABET, eval_job_id, is_transaction_id, new_transaction_id


class TransactionIdTests(unittest.TestCase):
    def test_format_and_alphabet(self):
        tx = new_transaction_id(datetime(2026, 11, 17, 9, 0))
        self.assertRegex(tx, r"^TX-261117-[A-Z0-9]{6}$")
        self.assertTrue(set(tx[-6:]) <= set(ALPHABET))
        self.assertFalse(set("01ILO") & set(ALPHABET))
        self.assertTrue(is_transaction_id(tx))

    def test_old_formats_are_not_transaction_ids(self):
        for v in ("gen_20261117_090000_123456", "eval_20261117_090000_1", "", None, "TX-261117-K7M2QD-E1"):
            self.assertFalse(is_transaction_id(v), v)

    def test_random_part_varies(self):
        # 30^6 공간에서 200개면 충돌 확률 약 0.003% — 무작위성 확인용 (대량 충돌 검사는 확률적으로 흔들린다)
        ids = {new_transaction_id() for _ in range(200)}
        self.assertEqual(len(ids), 200)

    def test_taken_ids_are_skipped(self):
        from unittest import mock
        seq = iter("AAAAAA" + "AAAAAA" + "BBBBBB")
        with mock.patch("backend.job_ids.secrets.choice", side_effect=lambda _: next(seq)):
            tx = new_transaction_id(datetime(2026, 11, 17), taken={"TX-261117-AAAAAA"})
        self.assertEqual(tx, "TX-261117-BBBBBB")


class EvalJobIdTests(unittest.TestCase):
    GEN = "TX-261117-K7M2QD"

    def test_first_and_next_numbers(self):
        self.assertEqual(eval_job_id(self.GEN, []), f"{self.GEN}-E1")
        existing = [f"{self.GEN}-E1", f"{self.GEN}-E3", "TX-261117-ZZZZZZ-E9", "eval_20261117_1", None]
        self.assertEqual(eval_job_id(self.GEN, existing), f"{self.GEN}-E4")

    def test_old_or_missing_generation_gets_new_transaction(self):
        for gen in ("gen_20261117_090000_123456", None):
            eid = eval_job_id(gen, [])
            self.assertTrue(is_transaction_id(eid), eid)
            self.assertIsNone(re.search(r"-E\d+$", eid))


if __name__ == "__main__":
    unittest.main()
