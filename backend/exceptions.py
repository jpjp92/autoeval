"""
backend/exceptions.py — 공통 예외 클래스

모든 모듈(generators, evaluators, ingestion)에서 공유하는 API 관련 예외.
"""


class APIQuotaExceededError(Exception):
    """API 비용 소진 또는 Rate Limit 초과 (429) — 즉시 중단, 재시도 불가."""
    pass


class APIAuthError(Exception):
    """API 키 인증 실패 — 즉시 중단."""
    pass
