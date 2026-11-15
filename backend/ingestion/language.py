"""
ingestion/language.py

문서 언어 판별 (ko | en).

숫자·기호·공백을 뺀 글자 중 한글과 라틴 문자 비율로 판정한다.
- 1차 범위는 문서 단위 판별만 한다. 블록 단위·mixed 정책은 다루지 않는다.
- 한글이 조금이라도 의미 있게 섞이면(기준 이상) 기존 한국어 경로(ko)를 유지한다.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable

_HANGUL_RE = re.compile(r"[가-힣ㄱ-ㅎㅏ-ㅣ]")
_LATIN_RE = re.compile(r"[A-Za-z]")

# 한글/(한글+라틴) 비율이 이 값 미만이면 영문 문서로 본다.
# 실측(2026-11-15): arXiv 영문 논문 2편 0.000, 한국어 보고서는 대부분 0.5 이상.
EN_HANGUL_RATIO_MAX = 0.05
# 판별에 필요한 최소 글자 수. 이보다 적으면 기존 동작(ko)을 유지한다.
MIN_LETTERS = 200


def detect_language(texts: Iterable[str]) -> Dict[str, Any]:
    """텍스트 목록의 문서 언어를 판별한다.

    Returns:
        {"language": "ko" | "en", "hangul_ratio": float, "letters": int}
        hangul_ratio는 측정값 그대로다(신뢰도 값을 임의로 만들지 않는다).
    """
    hangul = latin = 0
    for t in texts:
        if not t:
            continue
        hangul += len(_HANGUL_RE.findall(t))
        latin += len(_LATIN_RE.findall(t))
    letters = hangul + latin
    ratio = hangul / letters if letters else 0.0
    language = "en" if letters >= MIN_LETTERS and ratio < EN_HANGUL_RATIO_MAX else "ko"
    return {"language": language, "hangul_ratio": round(ratio, 4), "letters": letters}


def hangul_ratio(text: str) -> float:
    """단일 텍스트의 한글/(한글+라틴) 비율."""
    h = len(_HANGUL_RE.findall(text or ""))
    a = len(_LATIN_RE.findall(text or ""))
    return h / (h + a) if (h + a) else 0.0
