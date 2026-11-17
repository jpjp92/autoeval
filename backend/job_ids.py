"""
작업 ID (transaction 형식) — 기획: docs/Plan/PLAN_261117_JOB_ID.md

  QA 생성 : TX-261117-K7M2QD
  그 평가 : TX-261117-K7M2QD-E1  (재평가 -E2 …)

기존 gen_… / eval_… 기록은 그대로 둔다.
"""
import re
import secrets
from datetime import datetime
from typing import Iterable, Optional

PREFIX = "TX"
# Crockford Base32에서 헷갈리는 0, 1, I, L, O 제외
ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
RANDOM_LEN = 6

TX_RE = re.compile(rf"^{PREFIX}-\d{{6}}-[{ALPHABET}]{{{RANDOM_LEN}}}$")
EVAL_RE = re.compile(rf"^({PREFIX}-\d{{6}}-[{ALPHABET}]{{{RANDOM_LEN}}})-E(\d+)$")


def new_transaction_id(now: Optional[datetime] = None, taken: Iterable[str] = ()) -> str:
    """하루 경우의 수는 30^6 ≈ 7.3억이다. 하루 n건일 때 충돌 확률은 약 n²/(2×7.3억)
    (100건 ≈ 0.0007%, 1,000건 ≈ 0.07%). taken에 있는 ID(같은 서버의 작업)는 다시 뽑는다.
    DB의 job_id UNIQUE 제약이 마지막 방어선이다."""
    now = now or datetime.now()
    taken = set(taken)
    for _ in range(10):
        rand = "".join(secrets.choice(ALPHABET) for _ in range(RANDOM_LEN))
        tx = f"{PREFIX}-{now.strftime('%y%m%d')}-{rand}"
        if tx not in taken:
            return tx
    raise RuntimeError("transaction id collision retry exhausted")


def is_transaction_id(value: Optional[str]) -> bool:
    return bool(value and TX_RE.match(value))


def eval_job_id(generation_job_id: Optional[str], existing_ids: Iterable[str]) -> str:
    """생성 ID가 새 형식이면 {생성ID}-E{n}. n은 기존 번호 중 최대 + 1.
    옛 형식이거나 없으면 새 TX ID."""
    if not is_transaction_id(generation_job_id):
        return new_transaction_id(taken=existing_ids)
    top = 0
    for eid in existing_ids:
        m = EVAL_RE.match(eid or "")
        if m and m.group(1) == generation_job_id:
            top = max(top, int(m.group(2)))
    return f"{generation_job_id}-E{top + 1}"
