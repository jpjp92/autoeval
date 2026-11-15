"""
ingestion/language.py

문서 언어 판별 (ko | en).

숫자·기호·공백을 뺀 글자 중 한글과 라틴 문자 비율로 판정한다.
- 1차 범위는 문서 단위 판별만 한다. 블록 단위·mixed 정책은 다루지 않는다.
- 한글이 조금이라도 의미 있게 섞이면(기준 이상) 기존 한국어 경로(ko)를 유지한다.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, Iterable, List

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


# ── 영문 정규화 (source_language == "en" 에서만 사용) ─────────────────────────

_LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st"}
_LIGATURE_RE = re.compile("[\ufb00-\ufb06]")
# 줄바꿈 하이픈: "addi- tional", "addi-\ntional" (뒤 조각은 소문자로 시작)
# 하이픈 뒤에 공백·줄바꿈이 있어야 한다. "fine-tune" 처럼 붙어 있는 하이픈 단어는 건드리지 않는다.
_HYPHEN_BREAK_RE = re.compile(r"\b([A-Za-z]{2,})-(?:[ \t]*\n[ \t]*|[ \t]+)([a-z]{2,})\b")
_WORD_RE = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)*")


def build_word_counts(texts: Iterable[str]) -> Counter:
    """문서 전체 단어 빈도 (소문자). 하이픈 복원 판단에 쓴다."""
    counts: Counter = Counter()
    for t in texts:
        t = _LIGATURE_RE.sub(lambda m: _LIGATURES[m.group(0)], t or "")
        # 줄바꿈 하이픈 조각("com- bined"의 "com", "bined")은 단어로 세지 않는다.
        t = _HYPHEN_BREAK_RE.sub(" ", t)
        for w in _WORD_RE.findall(t):
            counts[w.lower()] += 1
    return counts


def normalize_english_text(text: str, word_counts: Counter | None = None) -> str:
    """합자를 풀고 줄바꿈 하이픈을 복원한다.

    결정 순서 (word_counts = 문서 전체 단어 빈도):
      1. 붙인 형태가 하이픈 형태보다 많이 나오면 붙인다      ("addi- tional" → "additional")
      2. 하이픈 형태가 문서에 있으면 하이픈을 유지한다        ("pre- trained" → "pre-trained")
      3. 두 조각이 모두 단독 단어로 나오면 하이픈을 유지한다  ("sequence- aligned" → "sequence-aligned")
      4. 나머지는 붙인다                                      ("espe- cially" → "especially")
    """
    if not text:
        return text
    text = _LIGATURE_RE.sub(lambda m: _LIGATURES[m.group(0)], text)
    counts = word_counts or Counter()

    def _join(m: re.Match) -> str:
        left, right = m.group(1), m.group(2)
        joined, hyphenated = (left + right).lower(), f"{left}-{right}".lower()
        if counts[joined] > counts[hyphenated]:
            return left + right
        both_words = (len(left) >= 3 and len(right) >= 3
                      and counts[left.lower()] > 0 and counts[right.lower()] > 0)
        if counts[hyphenated] > 0 or both_words:
            return f"{left}-{right}"
        return left + right

    return _HYPHEN_BREAK_RE.sub(_join, text)


def normalize_english_blocks(blocks: List[Dict[str, Any]]) -> int:
    """블록 text를 제자리에서 정규화하고, 바뀐 블록 수를 돌려준다."""
    counts = build_word_counts(b.get("text", "") for b in blocks)
    changed = 0
    for b in blocks:
        t = b.get("text", "")
        n = normalize_english_text(t, counts)
        if n != t:
            b["text"] = n
            changed += 1
    return changed
