"""
backend/ingestion/llm_chunker.py

LLM 기반 청킹 모듈 — Gemini 2.5 Flash를 사용해 원시 블록을 의미 단위 청크로 변환.

test/chunk_with_llm.py의 핵심 로직을 API에서 재사용 가능한 형태로 추출.
Rich progress / argparse / CLI 코드는 제거하고, gemini_client를 외부 주입 방식으로 변경.

Public API:
    recommend_params(page_count)  → dict
    run_llm_chunking(blocks, client, ...)  → list[dict]
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time

logger = logging.getLogger("autoeval.ingestion.llm_chunker")

# ──────────────────────────────────────────────────────────────
# 프롬프트
# ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
<role>
당신은 PDF 문서에서 추출된 텍스트 블록을 정리하고 의미 단위로 청킹하는 전문가입니다.
문서 유형(연구보고서, 법령, 정책문서 등)에 관계없이 범용적으로 적용합니다.
</role>

<input_format>
두 종류의 블록이 주어집니다:
- [CTX-인덱스] : 이전 배치에서 이미 처리된 컨텍스트 블록 — 문맥 참고용, 청크 출력 및 source_blocks 포함 금지
- [NEW-인덱스] : 이번 배치에서 청크로 만들어야 할 블록 — 반드시 청크화
</input_format>

<noise_correction>
PDF 추출 시 발생하는 아래 오류를 모두 수정하세요:

1. 문장 단절 — 한 문장이 여러 블록에 쪼개진 경우 이어붙이기
   예) "...정전을 방" + "지하기 위한..." → "...정전을 방지하기 위한..."

2. 불릿 기호 오염 — 텍스트 중간·끝에 끼어든 불릿 기호 제거
   - y (폰트 인코딩 오류 불릿): "개발 y", "시스템 y" → y 제거
   - ο (U+03BF Greek omicron, 불릿으로 쓰인 경우) → 제거
   - Smart, •, Ÿ, ∙, [ ], ■, □ (단독 토큰으로만 쓰인 경우) → 제거
   - 단, Smart가 실제 단어로 쓰인 경우(예: Smart Sensor)는 유지

3. 글자 사이 공백 — "산 업 자 원 부" → "산업자원부", "제 출 문" → "제출문"

4. 영문 약어·괄호 설명 분리 — 이어붙이기
   예) "감시/제어 시스템 (Wide Area" + "Monitoring and Control System)" → 합치기

5. 숫자·단위 분리 — "2.1" + "조원에" → "2.1조원에"

6. 구두점 위치 이상 — 줄 시작·끝에 홀로 있는 . , ; : → 앞 문장에 붙이기
</noise_correction>

<chunking_rules>
제목/헤더 통합
- Ⅰ, Ⅱ, Ⅲ, 1., 1.1, 1단계, 2단계, □, ■ 등으로 시작하는 제목 블록은 독립 청크로 만들지 말고
  바로 뒤 내용 청크의 첫 줄로 포함
- 형식: "제목\\n내용 첫 문장..."

청크 크기 (엄격 적용)
- 최소 200자 — 짧은 내용은 의미상 관련된 인접 청크와 합치세요
- 최대 800자 — 800자를 초과하는 청크는 절대 생성하지 마세요
- 800자에 도달하면 마침표(.) 또는 항목 경계(①②, 1. 2. 등)에서 즉시 분리하고 다음 청크로 이어가세요
- 분리된 후속 청크가 200자 미만이 되더라도, 800자 초과 방지를 우선합니다
- 목록 항목들은 같은 주제 단위로 묶되, 800자 초과 시 항목 단위로 나눠 여러 청크로 분리하세요

청크 끝맺음
- 청크는 반드시 완전한 문장으로 끝나야 합니다
- 또한, 그러나, 따라서, 이에, 한편, 특히, 즉, 이를, 그리고, 하지만, 아울러, 나아가, 더불어,
  뿐만 아니라, 그 결과, 이와 같이 등 접속사·연결어로 끝나는 경우:
  해당 단어를 다음 청크의 첫 단어로 넘기거나, 앞 완결 문장까지만 포함하세요
- 마침표(.), 완결 명사구, 완결된 항목 목록으로 끝나는 것이 올바른 경계입니다
</chunking_rules>

<table_rules>
블록이 [표]로 시작하는 마크다운 표(| 헤더 | ... / | --- | ... / | 셀 | ...)가 입력될 수 있습니다.

표 출처 표기 (필수)
- 표 블록이 청크의 주요 내용인 경우, 텍스트 첫 줄에 "[표] 표제목" 형식으로 표기하세요
- 표제목은 표 헤더 셀(첫 행)에서 추출하거나, 내용을 요약해 10자 이내로 작성
- 예) "[표] 고영향 인공지능의 확인(법 제33조)\\n① 인공지능사업자는 ..."
- 표 내용이 본문 청크에 일부만 포함될 경우에도 첫 줄에 "[표]" 마커 유지

표 변환 원칙
- 마크다운 파이프(|)와 구분선(---)은 출력 텍스트에 포함하지 마세요
- 표 내용을 자연스러운 한국어 산문 또는 번호 목록으로 변환하세요

표 유형별 변환 방법
1. 정의·용어 표 (헤더: 용어 | 설명) → "X란 Y를 의미한다." 형식의 서술문으로
   예) [표] 주요 용어 정의\\n인공지능이란 학습, 추론, 지각 등 인간의 지적 능력을 전자적으로 구현한 것이다.

2. 조항·규정 표 (법령 조항 나열) → 조항 번호와 내용을 "①~" 형식 그대로 산문으로
   예) [표] 법 제35조 고영향 AI 영향평가\\n① 인공지능사업자가 고영향 인공지능을 이용한 ...

3. 비교·현황 표 (여러 대상을 열별로 비교) → 각 항목을 주어-술어 문장으로 풀어쓰기
   예) [표] A·B 방식 비교\\nA방식은 ~이며, B방식은 ~이다.

4. 목록·열거 표 (단순 항목 나열) → 번호 목록으로 연결
   예) [표] 포함 사항\\n1. 개인정보 수집, 2. 처리 목적 고지, ...

표 크기 분리 원칙 (필수)
- 표 변환 후 800자를 초과하면 반드시 의미 단위에서 분리해 여러 청크로 나누세요
- 분리 시 각 후속 청크 첫 줄에도 "[표] 표제목 (계속)" 형식으로 마커를 유지하세요
  예) [표] 법 제33조 확인 절차 (계속)\\n③ 과학기술정보통신부장관은 ...
- 표 앞뒤 본문과 묶을 때도 합산 800자 초과 시 표 시작 전에 분리하세요
</table_rules>

<section_title_rules>
- 청크 전체 내용을 바탕으로 핵심 주제를 15자 이내로 간결하게 요약
- 청크에 명시적 제목(Ⅰ, 제1조, 1단계 등)이 있으면 우선 활용하되, 내용과 어울리게 다듬기
- 문서 내 위치·맥락을 반영한 구체적 표현 사용 (추상적 표현 지양)
- 예: "광역정전 방지 연구배경", "제3조 개인정보 보호원칙", "1단계 센서·통신 개발"
</section_title_rules>

<output_format>
순수 JSON 배열로만 응답하세요. 마크다운(```) 감싸기 금지.

[
  {
    "chunk_index": 0,
    "text": "제목\\n정리된 내용 텍스트",
    "section_title": "핵심 주제 제목",
    "source_blocks": [30, 31, 32]
  }
]

source_blocks에는 NEW 블록 인덱스만 기록합니다 (CTX 인덱스 포함 금지).
</output_format>
"""

USER_TEMPLATE = """\
아래 블록들을 위 규칙에 따라 정리해 주세요.
CTX 블록은 참고용, NEW 블록만 청크로 만드세요.

<blocks count="{count}" ctx="{ctx_count}" new="{new_count}">
{blocks}
</blocks>

순수 JSON 배열로만 응답:"""


# ──────────────────────────────────────────────────────────────
# DOCX 전용 프롬프트
# PDF 프롬프트와의 차이: <noise_correction> 제거, role 변경
# ──────────────────────────────────────────────────────────────

DOCX_SYSTEM_PROMPT = """\
<role>
당신은 DOCX 문서에서 python-docx로 추출된 단락·표 블록을 의미 단위 청크로 재구성하는 전문가입니다.
블록은 이미 구조화된 상태(단락/제목/표 분리 완료)이므로 노이즈 보정은 불필요합니다.
문서 유형(연구보고서, 법령, 정책문서, 매뉴얼 등)에 관계없이 범용적으로 적용합니다.
</role>

<input_format>
두 종류의 블록이 주어집니다:
- [CTX-인덱스] : 이전 배치에서 이미 처리된 컨텍스트 블록 — 문맥 참고용, 청크 출력 및 source_blocks 포함 금지
- [NEW-인덱스] : 이번 배치에서 청크로 만들어야 할 블록 — 반드시 청크화
</input_format>

<chunking_rules>
제목/헤더 통합
- Ⅰ, Ⅱ, Ⅲ, 1., 1.1, 1단계, 2단계, □, ■ 등으로 시작하는 제목 블록은 독립 청크로 만들지 말고
  바로 뒤 내용 청크의 첫 줄로 포함
- 형식: "제목\\n내용 첫 문장..."

청크 크기 (엄격 적용)
- 최소 200자 — 짧은 내용은 의미상 관련된 인접 청크와 합치세요
- 최대 800자 — 800자를 초과하는 청크는 절대 생성하지 마세요
- 800자에 도달하면 마침표(.) 또는 항목 경계(①②, 1. 2. 등)에서 즉시 분리하고 다음 청크로 이어가세요
- 분리된 후속 청크가 200자 미만이 되더라도, 800자 초과 방지를 우선합니다
- 목록 항목들은 같은 주제 단위로 묶되, 800자 초과 시 항목 단위로 나눠 여러 청크로 분리하세요

청크 끝맺음
- 청크는 반드시 완전한 문장으로 끝나야 합니다
- 또한, 그러나, 따라서, 이에, 한편, 특히, 즉, 이를, 그리고, 하지만, 아울러, 나아가, 더불어,
  뿐만 아니라, 그 결과, 이와 같이 등 접속사·연결어로 끝나는 경우:
  해당 단어를 다음 청크의 첫 단어로 넘기거나, 앞 완결 문장까지만 포함하세요
- 마침표(.), 완결 명사구, 완결된 항목 목록으로 끝나는 것이 올바른 경계입니다
</chunking_rules>

<table_rules>
블록이 [표]로 시작하거나 '| 셀 |' 형식의 마크다운 표가 입력될 수 있습니다.

표 출처 표기 (필수)
- 표 블록이 청크의 주요 내용인 경우, 텍스트 첫 줄에 "[표] 표제목" 형식으로 표기하세요
- 표제목은 표 헤더 셀(첫 행)에서 추출하거나, 내용을 요약해 10자 이내로 작성
- 예) "[표] 고영향 인공지능의 확인(법 제33조)\\n① 인공지능사업자는 ..."
- 표 내용이 본문 청크에 일부만 포함될 경우에도 첫 줄에 "[표]" 마커 유지

표 변환 원칙
- 마크다운 파이프(|)와 구분선(---)은 출력 텍스트에 포함하지 마세요
- 표 내용을 자연스러운 한국어 산문 또는 번호 목록으로 변환하세요

표 유형별 변환 방법
1. 정의·용어 표 (헤더: 용어 | 설명) → "X란 Y를 의미한다." 형식의 서술문으로
   예) [표] 주요 용어 정의\\n인공지능이란 학습, 추론, 지각 등 인간의 지적 능력을 전자적으로 구현한 것이다.

2. 조항·규정 표 (법령 조항 나열) → 조항 번호와 내용을 "①~" 형식 그대로 산문으로
   예) [표] 법 제35조 고영향 AI 영향평가\\n① 인공지능사업자가 고영향 인공지능을 이용한 ...

3. 비교·현황 표 (여러 대상을 열별로 비교) → 각 항목을 주어-술어 문장으로 풀어쓰기
   예) [표] A·B 방식 비교\\nA방식은 ~이며, B방식은 ~이다.

4. 목록·열거 표 (단순 항목 나열) → 번호 목록으로 연결
   예) [표] 포함 사항\\n1. 개인정보 수집, 2. 처리 목적 고지, ...

표 크기 분리 원칙 (필수)
- 표 변환 후 800자를 초과하면 반드시 의미 단위에서 분리해 여러 청크로 나누세요
- 분리 시 각 후속 청크 첫 줄에도 "[표] 표제목 (계속)" 형식으로 마커를 유지하세요
- 표 앞뒤 본문과 묶을 때도 합산 800자 초과 시 표 시작 전에 분리하세요
</table_rules>

<section_title_rules>
- 청크 전체 내용을 바탕으로 핵심 주제를 15자 이내로 간결하게 요약
- 청크에 명시적 제목(Ⅰ, 제1조, 1단계 등)이 있으면 우선 활용하되, 내용과 어울리게 다듬기
- 문서 내 위치·맥락을 반영한 구체적 표현 사용 (추상적 표현 지양)
- 예: "연구 배경 및 목적", "제3조 개인정보 보호원칙", "1단계 센서·통신 개발"
</section_title_rules>

<output_format>
순수 JSON 배열로만 응답하세요. 마크다운(```) 감싸기 금지.

[
  {
    "chunk_index": 0,
    "text": "제목\\n정리된 내용 텍스트",
    "section_title": "핵심 주제 제목",
    "source_blocks": [30, 31, 32]
  }
]

source_blocks에는 NEW 블록 인덱스만 기록합니다 (CTX 인덱스 포함 금지).
</output_format>
"""

try:
    from config.models import MODEL_CONFIG
    DEFAULT_MODEL = MODEL_CONFIG["gemini-flash"]["model_id"]
except Exception:
    DEFAULT_MODEL = "gemini-2.5-flash"


# ──────────────────────────────────────────────────────────────
# 파라미터 추천
# ──────────────────────────────────────────────────────────────

def recommend_params(page_count: int) -> dict:
    """페이지 수 기반 티어 판정 및 파라미터 추천.

    티어 정책:
      S  (≤20p)    batch=30 parallel=3 overlap=3  max_output=8192
      M  (21-50p)  batch=30 parallel=3 overlap=3  max_output=8192
      L  (51-100p) batch=40 parallel=5 overlap=3  max_output=12288
      XL (101-200p) batch=50 parallel=5 overlap=5 max_output=16384
      XXL(200p+)   batch=50 parallel=5 overlap=5  max_output=16384
    """
    if page_count <= 20:
        tier, batch, parallel, overlap, max_out = "S", 30, 3, 3, 8192
    elif page_count <= 50:
        tier, batch, parallel, overlap, max_out = "M", 30, 3, 3, 8192
    elif page_count <= 100:
        tier, batch, parallel, overlap, max_out = "L", 40, 5, 3, 12288
    elif page_count <= 200:
        tier, batch, parallel, overlap, max_out = "XL", 50, 5, 5, 16384
    else:
        tier, batch, parallel, overlap, max_out = "XXL", 50, 5, 5, 16384

    return {
        "tier": tier,
        "batch_size": batch,
        "parallel": parallel,
        "overlap": overlap,
        "max_output_tokens": max_out,
    }


def recommend_params_docx(block_count: int) -> dict:
    """블록 수 기반 티어 판정 (DOCX 전용 — page=1 고정이므로 블록 수 사용).

    티어 정책:
      S  (≤60블록)    batch=30 parallel=3 overlap=3
      M  (61-150블록) batch=30 parallel=3 overlap=3
      L  (151-300블록) batch=40 parallel=5 overlap=3
      XL (300블록+)   batch=50 parallel=5 overlap=5
    """
    if block_count <= 60:
        tier, batch, parallel, overlap = "S", 30, 3, 3
    elif block_count <= 150:
        tier, batch, parallel, overlap = "M", 30, 3, 3
    elif block_count <= 300:
        tier, batch, parallel, overlap = "L", 40, 5, 3
    else:
        tier, batch, parallel, overlap = "XL", 50, 5, 5

    return {"tier": tier, "batch_size": batch, "parallel": parallel, "overlap": overlap}


# ──────────────────────────────────────────────────────────────
# 배치 분할
# ──────────────────────────────────────────────────────────────

def build_char_aware_batches(
    blocks: list[dict],
    batch_size: int,
    overlap: int,
    max_chars: int = 4000,
) -> list[tuple[int, list, list]]:
    """블록 수(batch_size)와 누적 문자 수(max_chars) 중 먼저 도달한 기준으로 배치 분할.

    표 블록(~1,600자) 포함 시 토큰 폭발 방지.
    반환: [(batch_num, ctx_blocks, new_blocks), ...]
    """
    batches: list[tuple[int, list, list]] = []
    i, batch_num = 0, 0
    while i < len(blocks):
        new_blocks = []
        char_count = 0
        j = i
        while j < len(blocks) and len(new_blocks) < batch_size:
            block_chars = len(blocks[j]["text"])
            if new_blocks and char_count + block_chars > max_chars:
                break
            new_blocks.append(blocks[j])
            char_count += block_chars
            j += 1
        ctx_blocks = blocks[max(0, i - overlap): i] if i > 0 else []
        batch_num += 1
        batches.append((batch_num, ctx_blocks, new_blocks))
        i = j
    return batches


# ──────────────────────────────────────────────────────────────
# 후처리
# ──────────────────────────────────────────────────────────────

def _jaccard(a: list[int], b: list[int]) -> float:
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def merge_short_chunks(chunks: list[dict], min_chars: int = 100) -> list[dict]:
    """min_chars 미만 청크를 인접 청크에 흡수 (반복 수렴)."""
    if not chunks:
        return chunks
    result = list(chunks)
    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(result):
            if len(result[i]["text"]) < min_chars:
                if i + 1 < len(result):
                    nxt = result[i + 1]
                    result[i + 1] = {
                        **nxt,
                        "text": result[i]["text"] + "\n" + nxt["text"],
                        "source_blocks": sorted(set(result[i]["source_blocks"] + nxt["source_blocks"])),
                    }
                    result.pop(i)
                elif i > 0:
                    prev = result[i - 1]
                    result[i - 1] = {
                        **prev,
                        "text": prev["text"] + "\n" + result[i]["text"],
                        "source_blocks": sorted(set(prev["source_blocks"] + result[i]["source_blocks"])),
                    }
                    result.pop(i)
                else:
                    i += 1
                changed = True
            else:
                i += 1
    for i, c in enumerate(result):
        c["chunk_index"] = i
    return result


_DANGLING_RE = re.compile(
    r'[\s,]*(?:또한|그러나|따라서|이에|한편|특히|즉|이를|그리고|하지만|아울러|나아가|더불어|'
    r'뿐만 아니라|그 결과|이와 같이|이처럼|이러한|이를 위해|이를 통해|이와 함께)\s*$'
)


def trim_dangling_conjunctions(chunks: list[dict]) -> list[dict]:
    """청크 끝에 홀로 남은 접속사/연결어를 다음 청크 앞으로 이동."""
    for i, chunk in enumerate(chunks):
        m = _DANGLING_RE.search(chunk["text"])
        if not m:
            continue
        dangling = m.group(0).strip().lstrip(",").strip()
        chunk["text"] = chunk["text"][:m.start()].rstrip()
        if i + 1 < len(chunks):
            chunks[i + 1]["text"] = dangling + " " + chunks[i + 1]["text"].lstrip()
    return chunks


def deduplicate_chunks(chunks: list[dict], threshold: float = 0.5) -> list[dict]:
    """source_blocks Jaccard 유사도 > threshold 이면 중복으로 판단, 긴 텍스트를 유지."""
    result: list[dict] = []
    for chunk in chunks:
        src = chunk.get("source_blocks", [])
        merged = False
        for i, kept in enumerate(result):
            if _jaccard(src, kept.get("source_blocks", [])) > threshold:
                if len(chunk["text"]) > len(kept["text"]):
                    result[i] = chunk
                merged = True
                break
        if not merged:
            result.append(chunk)
    for i, c in enumerate(result):
        c["chunk_index"] = i
    return result


# ──────────────────────────────────────────────────────────────
# LLM 호출
# ──────────────────────────────────────────────────────────────

def _build_block_list(ctx_blocks: list[dict], new_blocks: list[dict]) -> str:
    lines = []
    for b in ctx_blocks:
        safe = b["text"].replace("\n", " ↵ ").strip()
        lines.append(f"[CTX-{b['index']}] {safe}")
    for b in new_blocks:
        safe = b["text"].replace("\n", " ↵ ").strip()
        lines.append(f"[NEW-{b['index']}] {safe}")
    return "\n".join(lines)


def _call_gemini_sync(prompt: str, client, model: str, batch_size: int) -> str:
    """동기 Gemini 호출 (asyncio.to_thread에서 실행).

    - temperature=0.1  : JSON 구조적 변환 — 일관성 우선
    - thinking_budget=0: 청킹은 Easy Task, thinking 불필요 (속도·비용 개선)
    - max_output_tokens: 배치 크기 기반 동적 설정 (8192 / 12288 / 16384)
    """
    from google.genai import types as genai_types

    if batch_size <= 30:
        max_out = 8192
    elif batch_size <= 40:
        max_out = 12288
    else:
        max_out = 16384

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            temperature=0.1,
            top_p=0.95,
            max_output_tokens=max_out,
            thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return response.text.strip()


async def _process_batch(
    semaphore: asyncio.Semaphore,
    batch_num: int,
    ctx_blocks: list[dict],
    new_blocks: list[dict],
    client,
    model: str,
    batch_size: int,
    system_prompt: str = SYSTEM_PROMPT,
) -> tuple[int, list[dict]]:
    """단일 배치 비동기 처리."""
    new_indices = {b["index"] for b in new_blocks}
    idx_to_page = {b["index"]: b["page"] for b in new_blocks}

    user_msg = USER_TEMPLATE.format(
        count=len(ctx_blocks) + len(new_blocks),
        ctx_count=len(ctx_blocks),
        new_count=len(new_blocks),
        ctx=len(ctx_blocks),
        new=len(new_blocks),
        blocks=_build_block_list(ctx_blocks, new_blocks),
    )
    prompt = system_prompt + "\n\n" + user_msg

    async with semaphore:
        t0 = time.time()
        try:
            raw = await asyncio.to_thread(_call_gemini_sync, prompt, client, model, batch_size)
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

            parsed: list[dict] = json.loads(raw)
            batch_chunks = []
            for item in parsed:
                src_new = [s for s in item.get("source_blocks", []) if s in new_indices]
                if src_new:
                    item["source_blocks"] = src_new
                    item["page"] = idx_to_page.get(src_new[0], 0)
                    if not item.get("section_title"):
                        first_line = item.get("text", "").split("\n")[0].strip()
                        item["section_title"] = first_line[:30] if first_line else ""
                    batch_chunks.append(item)

            elapsed = time.time() - t0
            logger.info(
                f"Batch {batch_num}: NEW[{new_blocks[0]['index']}~{new_blocks[-1]['index']}] "
                f"CTX {len(ctx_blocks)} -> {len(batch_chunks)} chunks ({elapsed:.1f}s)"
            )
            return batch_num, batch_chunks

        except json.JSONDecodeError as e:
            elapsed = time.time() - t0
            logger.warning(f"Batch {batch_num}: JSON parse failed ({elapsed:.1f}s), fallback applied: {e}")
            return batch_num, [
                {
                    "text": b["text"],
                    "section_title": b["text"].split("\n")[0].strip()[:30],
                    "source_blocks": [b["index"]],
                    "page": b["page"],
                    "fallback": True,
                }
                for b in new_blocks
            ]

        except Exception as e:
            elapsed = time.time() - t0
            logger.error(f"Batch {batch_num}: error ({elapsed:.1f}s): {e}")
            return batch_num, [
                {
                    "text": b["text"],
                    "section_title": b["text"].split("\n")[0].strip()[:30],
                    "source_blocks": [b["index"]],
                    "page": b["page"],
                    "error": str(e),
                }
                for b in new_blocks
            ]


# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────

async def run_llm_chunking(
    blocks: list[dict],
    client,
    model: str = DEFAULT_MODEL,
    page_count: int = 0,
    batch_size: int | None = None,
    overlap: int | None = None,
    parallel: int | None = None,
) -> list[dict]:
    """원시 블록 목록을 받아 LLM 청킹 후 청크 목록을 반환.

    Args:
        blocks:     [{index, page, text}, ...] — parsers.extract_text_by_page 출력을 평탄화한 것
        client:     google_genai.Client 인스턴스
        model:      Gemini 모델 ID
        page_count: PDF 총 페이지 수 (recommend_params 자동 적용용, 0이면 블록 수 기반 추정)
        batch_size: 배치당 블록 수 (None이면 page_count 기반 자동)
        overlap:    CTX overlap 블록 수 (None이면 자동)
        parallel:   동시 배치 처리 수 (None이면 자동)

    Returns:
        [{chunk_index, text, section_title, source_blocks, page}, ...]
        후처리(merge_short / trim_dangling / dedup) 완료 상태로 반환.
    """
    if not blocks:
        return []

    # page_count 미제공 시 블록 페이지 범위로 추정
    if page_count == 0 and blocks:
        page_count = max(b.get("page", 1) for b in blocks)

    rec = recommend_params(page_count)
    _batch_size = batch_size if batch_size is not None else rec["batch_size"]
    _overlap    = overlap    if overlap    is not None else rec["overlap"]
    _parallel   = parallel   if parallel   is not None else rec["parallel"]

    logger.info(
        f"LLM chunking start: {len(blocks)} blocks, tier={rec['tier']}, "
        f"batch={_batch_size}, overlap={_overlap}, parallel={_parallel}"
    )

    semaphore = asyncio.Semaphore(_parallel)
    batches = build_char_aware_batches(blocks, _batch_size, _overlap)

    tasks = [
        _process_batch(semaphore, bn, cb, nb, client, model, _batch_size)
        for bn, cb, nb in batches
    ]
    results = await asyncio.gather(*tasks)

    # 배치 번호 순 정렬 후 chunk_index 재부여
    results = sorted(results, key=lambda x: x[0])
    all_chunks: list[dict] = []
    offset = 0
    for _, batch_chunks in results:
        for item in batch_chunks:
            item["chunk_index"] = offset
            all_chunks.append(item)
            offset += 1

    # 후처리
    all_chunks = merge_short_chunks(all_chunks)
    all_chunks = trim_dangling_conjunctions(all_chunks)
    all_chunks = deduplicate_chunks(all_chunks)

    logger.info(f"LLM chunking done: {len(all_chunks)} chunks")
    return all_chunks


async def run_llm_chunking_docx(
    blocks: list[dict],
    client,
    model: str = DEFAULT_MODEL,
    batch_size: int | None = None,
    overlap: int | None = None,
    parallel: int | None = None,
) -> list[dict]:
    """DOCX 전용 LLM 청킹.

    PDF 버전(run_llm_chunking)과의 차이:
    - DOCX_SYSTEM_PROMPT 사용 (noise_correction 제거)
    - recommend_params_docx(block_count) — 페이지 수가 아닌 블록 수 기반 파라미터 추천

    Args:
        blocks:     [{index, page, text}, ...] — parsers.extract_text_by_page DOCX 출력 평탄화
        client:     google_genai.Client 인스턴스
        model:      Gemini 모델 ID
        batch_size: 배치당 블록 수 (None이면 블록 수 기반 자동)
        overlap:    CTX overlap 블록 수 (None이면 자동)
        parallel:   동시 배치 처리 수 (None이면 자동)

    Returns:
        [{chunk_index, text, section_title, source_blocks, page}, ...]
        후처리(merge_short / trim_dangling / dedup) 완료 상태로 반환.
    """
    if not blocks:
        return []

    rec = recommend_params_docx(len(blocks))
    _batch_size = batch_size if batch_size is not None else rec["batch_size"]
    _overlap    = overlap    if overlap    is not None else rec["overlap"]
    _parallel   = parallel   if parallel   is not None else rec["parallel"]

    logger.info(
        f"DOCX LLM chunking start: {len(blocks)} blocks, tier={rec['tier']}, "
        f"batch={_batch_size}, overlap={_overlap}, parallel={_parallel}"
    )

    semaphore = asyncio.Semaphore(_parallel)
    batches = build_char_aware_batches(blocks, _batch_size, _overlap)

    tasks = [
        _process_batch(semaphore, bn, cb, nb, client, model, _batch_size,
                       system_prompt=DOCX_SYSTEM_PROMPT)
        for bn, cb, nb in batches
    ]
    results = await asyncio.gather(*tasks)

    results = sorted(results, key=lambda x: x[0])
    all_chunks: list[dict] = []
    offset = 0
    for _, batch_chunks in results:
        for item in batch_chunks:
            item["chunk_index"] = offset
            all_chunks.append(item)
            offset += 1

    all_chunks = merge_short_chunks(all_chunks)
    all_chunks = trim_dangling_conjunctions(all_chunks)
    all_chunks = deduplicate_chunks(all_chunks)

    logger.info(f"DOCX LLM chunking done: {len(all_chunks)} chunks")
    return all_chunks
