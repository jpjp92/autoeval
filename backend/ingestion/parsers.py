"""
Ingestion Parsers & Preprocessors
===================================
PDF/DOCX 텍스트 추출 및 전처리 순수 함수 모음.
I/O 없음 — 입력은 bytes/str, 출력은 Python 자료구조.

사용처:
    from ingestion.parsers import extract_text_by_page, normalize_text, ...
"""

from __future__ import annotations

import io
import re
import hashlib
import logging
from collections import Counter
from typing import Any, Dict, List, Optional

import fitz  # PyMuPDF
from docx import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger("autoeval.ingestion.parsers")


# ============================================================================
# 텍스트 정규화
# ============================================================================

def _smart_join_lines(text: str) -> str:
    """
    PDF 시각적 줄바꿈을 공백으로 결합.
    단락 경계(빈 줄), 불릿/표/제목 시작 줄은 보존.
    """
    lines = text.split('\n')
    result = []
    buffer = ""
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if buffer:
                result.append(buffer)
                buffer = ""
            result.append("")
            continue
        if not buffer:
            buffer = stripped
        elif (
            not re.search(r'[.!?。]$', buffer)
            and not re.match(r'^[-•|\[#\d]', stripped)
        ):
            buffer += ' ' + stripped
        else:
            result.append(buffer)
            buffer = stripped
    if buffer:
        result.append(buffer)
    return '\n'.join(result)


def normalize_text(text: str) -> str:
    """
    RAG 품질을 위한 텍스트 정규화 (구조 보존형)
    - Ÿ/특수문자 불릿 아티팩트 제거 (PDF 폰트 인코딩 오류)
    - 불렛 기호 표준화 (•, *, l → -)
    - 체크박스/폼 필드 기호 정규화 (□ → [ ], ☑ → [v])
    - 중첩 표 아티팩트 제거 (⋮, ⋯ 수직 생략 기호)
    - 다중 공백 제거
    - 문장 중간 줄바꿈 → 공백 결합 (단락/불릿/표 경계 보존)
    """
    if not text:
        return ""

    text = re.sub(r'[\u0178\u00ff\ufffd]', '-', text)
    text = re.sub(r'[□☐\u25a1\u2610]', '[ ]', text)
    text = re.sub(r'[☑✓✔\u2611\u2713\u2714]', '[v]', text)
    text = re.sub(r'[\u22ee\u22ef\u22f0\u22f1]', '', text)
    text = re.sub(r'^[ \t]*[•*l][ \t]+', '- ', text, flags=re.MULTILINE)
    text = re.sub(r'[ \t]+', ' ', text)
    text = _smart_join_lines(text)
    return text.strip()


def normalize_for_hash(text: str) -> str:
    """중복 제거를 위한 강력한 정규화 (소문자화, 공백/특수문자 제거)"""
    text = text.lower()
    text = re.sub(r'\s+', '', text)
    text = re.sub(r'[^\w가-힣]', '', text)
    return text


# 원형 숫자 기호 (①-⑳, ㉑-㊿)
_CIRCLE_NUM_RE = re.compile(r'[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]')


def _span_text_with_spaces(span: dict) -> str:
    """rawdict span의 chars bbox 간격을 분석해 누락된 공백 복원.

    rawdict 모드에서 span["text"]는 존재하지 않으므로 chars에서 항상 재구성.
    한글이 포함된 경우 문자 간 gap이 평균 문자 폭의 40% 이상이면 공백 삽입.
    chars가 없으면 span["text"] fallback (dict 모드 호환).
    """
    chars = span.get("chars", [])

    # chars 없으면 dict 모드 fallback
    if not chars:
        return span.get("text", "")

    has_korean = any(re.search(r'[가-힣]', c.get("c", "")) for c in chars)

    if not has_korean:
        # 한글 없으면 단순 chars 재구성 (공백 감지 불필요)
        return "".join(c.get("c", "") for c in chars)

    # 한글 포함: 문자 너비 기반 공백 감지
    widths = [c["bbox"][2] - c["bbox"][0] for c in chars if c["bbox"][2] > c["bbox"][0]]
    if not widths:
        return "".join(c.get("c", "") for c in chars)
    avg_w = sum(widths) / len(widths)
    threshold = avg_w * 0.4

    result = ""
    prev_x1: Optional[float] = None
    for char in chars:
        c = char.get("c", "")
        if not c:
            continue
        if c == ' ':
            result += c
            prev_x1 = char["bbox"][2]
            continue
        if prev_x1 is not None and (char["bbox"][0] - prev_x1) > threshold:
            result += " "
        result += c
        prev_x1 = char["bbox"][2]
    return result if result else "".join(c.get("c", "") for c in chars)


# ============================================================================
# 섹션 감지 & 구조화
# ============================================================================

def detect_section_level(title: str) -> Optional[int]:
    """제목 패턴을 분석하여 섹션 레벨 반환 (1, 2, 3...)"""
    patterns = [
        (r'^[0-9]+\.[0-9]+\.[0-9]+', 3),
        (r'^[0-9]+\.[0-9]+', 2),
        (r'^제\s*[0-9]+\s*장', 1),
        (r'^제\s*[0-9]+\s*절', 2),
        (r'^제\s*[0-9]+\s*조', 2),   # 법률 조문: 章(1) > 條(2)
        (r'^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]', 1),
        (r'^\[[^\]]{2,}\]', 1),
        (r'^\d+\s+\S', 2),
    ]
    for pattern, level in patterns:
        if re.match(pattern, title.strip()):
            return level
    return None


def detect_heading(text: str, font_size: float, prev_font_size: float) -> Optional[str]:
    """제목(Heading) 감지 로직."""
    clean_text = text.strip()
    if not clean_text or len(clean_text) > 100:
        return None

    if re.match(r'^[-•ŸŸ∙]\s', clean_text):
        return None

    # 괄호 주석 패턴 제외: (정확성과 신뢰성), (별첨1) 등 → 본문 소항목
    if re.match(r'^\([가-힣a-zA-Z]', clean_text):
        return None

    # 법률 개정 주석 블록 제외: '여야 한다.<신설 2023. 3. 14.>' 등 → 앞 조문의 꼬리
    # 단, 제X조 패턴이 있는 조문 제목은 허용 (e.g. '제2조(정의) ... <개정 2023. 3. 14.>')
    _amendment_re = re.compile(r'<(신설|개정|삭제)')
    _article_re   = re.compile(r'^제\s*\d+')
    if _amendment_re.search(clean_text) and not _article_re.match(clean_text):
        return None

    if re.search(r'[·\.]{3,}', clean_text) or re.search(r'\.{5,}', clean_text):
        return None

    if len(clean_text) >= 15:
        symbols = re.findall(r'[·]', clean_text)
        if len(symbols) / len(clean_text) > 0.2:
            return None

    heading_patterns = [
        r'^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]',
        r'^제\s*\d+\s*장',
        r'^제\s*\d+\s*절',
        r'^제\s*\d+\s*조',        # 법률 조문 (제2조, 제3조...)
        r'^\d+\.\d+(\.\d+)?',    # 보고서 섹션 번호 (1.1, 1.1.1)
        r'^부\s*칙',
    ]

    is_pattern_match = (
        any(re.match(p, clean_text) for p in heading_patterns)
        and font_size >= 10.0   # running header(font 8~9) 오분류 방지
    )
    is_font_boost = font_size > prev_font_size + 1.5 and font_size > 12.5

    if is_pattern_match or is_font_boost:
        if len(clean_text) < 2 or clean_text.isdigit():
            return None
        return clean_text
    return None


def build_sections(blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """제목을 기준으로 블록들을 논리적 섹션으로 그룹화."""
    sections = []
    current_section: Dict[str, Any] = {"heading": "Root", "level": 0, "blocks": [], "page": 1}
    prev_font_size = 10.0

    for b in blocks:
        text = b.get("text", "")
        font_size = b.get("font_size", 10.0)

        heading = detect_heading(text, font_size, prev_font_size)
        if heading:
            if current_section["blocks"]:
                sections.append(current_section)
            level = detect_section_level(heading) or min(current_section["level"] + 1, 4)
            current_section = {
                "heading": heading,
                "level": level,
                "blocks": [b],
                "page": b.get("page", 1),
            }
        else:
            current_section["blocks"].append(b)

        prev_font_size = font_size

    if current_section["blocks"]:
        sections.append(current_section)
    return sections


# ============================================================================
# 청크 필터링
# ============================================================================

def is_toc_chunk(text: str) -> bool:
    """
    목차(Table of Contents) 청크인지 판단.
    - Layer 1: 가운뎃점(·) 밀도
    - Layer 2: 연속 가운뎃점 패턴
    - Layer 3: 점선 + 페이지번호 라인 비율
    - Layer 4: "목차" 키워드 + 다수 섹션 번호 패턴 (번호 목차 형식)
    - Layer 5: 섹션 번호 밀도만으로 판단 (목차 키워드 없어도)
    """
    if not text or len(text) < 20:
        return False

    is_table_content = text.count('|') >= 4

    if not is_table_content:
        special_dots = text.count('·')
        if special_dots > 10 and special_dots / len(text) > 0.05:
            return True

    if re.search(r'[·]{4,}', text):
        return True

    if not is_table_content:
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        if lines:
            toc_lines = sum(
                1 for line in lines
                if (line.count('·') > 3 or line.count('.') > 5)
                and any(c.isdigit() for c in line[-5:])
            )
            if toc_lines / len(lines) >= 0.6:
                return True

    # Layer 4: "목차" 키워드 + 섹션 번호 5개 이상
    # 예: "목 차 서론 1. 개요 1.1 배경 1.2 ..." 형태 감지
    if re.search(r'목\s*차', text):
        section_nums = re.findall(r'\b\d+\.\d+', text)
        if len(section_nums) >= 5:
            return True

    # Layer 5: 섹션 번호 밀도 높고 문장 부호(마침표로 끝나는 완성 문장) 거의 없음
    # → 설명 없이 항목 나열만 있는 경우
    if not is_table_content:
        section_nums = re.findall(r'\b\d+\.\d+', text)
        word_count = len(text.split())
        # 단어 20개 당 섹션 번호 1개 이상이면 목차성 높음
        if word_count > 0 and len(section_nums) / word_count >= 0.05 and len(section_nums) >= 8:
            # 실제 문장(마침표·물음표로 끝나는 한국어 문장)이 거의 없으면 목차로 판정
            sentences = re.findall(r'[가-힣][^。.!?]{10,}[。.!?]', text)
            if len(sentences) <= 2:
                return True

    return False


_COLOPHON_KEYWORDS = ["발행처:", "발행인:", "저작권", "©", "무단전재", "재배포를 금"]


def _is_colophon_chunk(text: str) -> bool:
    """발행처/저작권 페이지 청크 판별 — 2개 이상 키워드 포함 시 True."""
    return sum(1 for kw in _COLOPHON_KEYWORDS if kw in text) >= 2


def _is_symbol_noise_chunk(text: str) -> bool:
    """기호/체크박스 위주의 의미없는 청크 감지."""
    if not text or len(text) < 10:
        return False
    base = re.sub(r'[\s|]', '', text)
    if not base:
        return True
    meaningful = len(re.findall(r'[가-힣a-zA-Z0-9]', base))
    return len(base) >= 15 and meaningful / len(base) < 0.15


# ============================================================================
# 청크 후처리
# ============================================================================

_ARTICLE_BOUNDARY_RE = re.compile(r'^제\s*\d+조')  # 제X조 시작 — 병합 금지 경계


def _merge_short_chunks(chunks: list, min_chars: int = 200, max_chars: int = 1200) -> list:
    """같은 섹션 내 min_chars 미만 청크를 인접 청크와 병합 (최대 max_chars까지).

    제X조 시작 청크는 병합하지 않음 — 이전 조문 꼬리가 새 조문 앞에 붙는 현상 방지.
    """
    if not chunks:
        return chunks
    merged = []
    buf = chunks[0]
    for chunk in chunks[1:]:
        next_is_article = bool(_ARTICLE_BOUNDARY_RE.match(chunk.lstrip()))
        if (
            not next_is_article
            and len(buf) < min_chars
            and len(buf) + len(chunk) <= max_chars
        ):
            buf = buf + "\n" + chunk
        else:
            merged.append(buf)
            buf = chunk
    merged.append(buf)
    return merged


def detect_repeated_headers(pages: List[Dict[str, Any]], threshold: int = 5) -> set:
    """여러 페이지에 반복 등장하는 텍스트(header/footer)를 감지."""
    line_counter: Counter = Counter()
    for page_data in pages:
        page_text = page_data.get("text", "")
        lines = [l.strip() for l in page_text.split("\n") if l.strip() and len(l.strip()) > 5]
        for line in set(lines):
            if re.match(r'^[\|\s\-:]+$', line):
                continue
            line_counter[line] += 1
    return {line for line, count in line_counter.items() if count >= threshold}


def remove_footer_noise(text: str, repeated_headers: set = None) -> str:
    """footer/header bleed-through 노이즈 제거."""
    lines = text.split("\n")
    cleaned = []
    for line in lines:
        stripped = line.strip()
        if re.match(r'^\d{1,3}$', stripped):
            continue
        if repeated_headers and stripped in repeated_headers:
            continue
        cleaned.append(line)
    return "\n".join(cleaned)


_NUMBERED_ITEM_RE = re.compile(r'^(\d+[\.의]|[가-힣]\.)\s')

def strip_redundant_headings(chunk_text: str, section_title: str) -> str:
    """청크에서 이미 metadata에 포함된 section heading 라인 제거.

    번호 붙은 정의항목(예: '7. "고정형 영상정보처리기기"란...')은 내용 라인이므로 제거하지 않음.
    """
    if _NUMBERED_ITEM_RE.match(section_title.strip()):
        return chunk_text
    lines = chunk_text.split('\n')
    if not lines:
        return chunk_text
    if lines[0].strip() == section_title.strip():
        remaining = '\n'.join(lines[1:]).strip()
        if remaining:
            return remaining
    return chunk_text


def merge_adjacent_short_blocks(
    blocks_data: List[Dict[str, Any]],
    text_parts: List[str],
) -> tuple:
    """
    PDF block split 문제 해결: 짧은 숫자/기호 블록을 다음 블록과 병합.
    예: ["1"] + ["작성 배경"] → ["1 작성 배경"]
    """
    if not blocks_data or not text_parts:
        return blocks_data, text_parts

    merged_blocks: List[Dict[str, Any]] = []
    merged_texts: List[str] = []
    i = 0

    while i < len(blocks_data):
        current_block = blocks_data[i]
        current_text = text_parts[i]
        stripped = current_text.strip()
        is_short_number = len(stripped) <= 3 and re.match(r'^\d+$', stripped)
        is_short_symbol = len(stripped) <= 3 and re.match(r'^[•·\-_]+$', stripped)

        if (is_short_number or is_short_symbol) and i + 1 < len(blocks_data):
            next_block = blocks_data[i + 1]
            next_text = text_parts[i + 1]
            merged_text = f"{stripped} {next_text.strip()}"
            merged_block = {
                **current_block,
                "text": merged_text,
                "bbox": [
                    current_block["bbox"][0], current_block["bbox"][1],
                    next_block["bbox"][2], next_block["bbox"][3],
                ],
            }
            merged_blocks.append(merged_block)
            merged_texts.append(merged_text)
            i += 2
        else:
            merged_blocks.append(current_block)
            merged_texts.append(current_text)
            i += 1

    return merged_blocks, merged_texts


# ============================================================================
# 메타데이터 헬퍼
# ============================================================================

def detect_chunk_type(text: str) -> str:
    """청크의 내용 구조를 분석하여 타입 분류."""
    lines = text.strip().split('\n')
    if len(text) < 150 and not text.strip().startswith("- "):
        return "Heading"
    if any(line.strip().startswith("- ") for line in lines[:2]):
        return "List"
    if "|" in text and "-" in text:
        return "Table"
    return "Body"


def build_context_prefix(filename: str, section_title: str, page: int) -> str:
    """RAG 검색 품질 향상을 위한 표준 컨텍스트 프리픽스."""
    return f"문서: {filename}\n섹션: {section_title}\n페이지: {page}\n\n"


def _resolve_chunk_page(
    chunk_text: str,
    section_text: str,
    block_page_offsets: list,
    default_page: int,
) -> int:
    """청크 텍스트의 실제 페이지를 block offset 역추적으로 계산."""
    if not block_page_offsets:
        return default_page
    search = chunk_text[:60].strip()
    pos = section_text.find(search)
    if pos < 0:
        return default_page
    page = default_page
    for offset, pg in block_page_offsets:
        if offset <= pos:
            page = pg
        else:
            break
    return page


# ============================================================================
# 표 추출
# ============================================================================

def is_inside_table(block_bbox, table_bboxes: list) -> bool:
    """블록 중심점이 테이블 bbox 영역 내에 위치하는지 확인."""
    bx0, by0, bx1, by1 = block_bbox
    b_cx = (bx0 + bx1) / 2
    b_cy = (by0 + by1) / 2
    for tbbox in table_bboxes:
        tx0, ty0, tx1, ty1 = tbbox
        if tx0 <= b_cx <= tx1 and ty0 <= b_cy <= ty1:
            return True
    return False


def format_table_as_text(table_data: list, page=None, table_obj=None) -> str:
    """
    PyMuPDF extract() 결과를 Markdown 테이블 텍스트로 변환.
    - rowspan None 셀을 words 기반으로 보완
    - rowspan forward-fill 적용
    - 구조 기반 제목 테이블 감지 → heading 텍스트로 반환
    """
    if not table_data:
        return ""

    if page is not None and table_obj is not None:
        try:
            words = page.get_text("words")
            col_xs = [(hc[0], hc[2]) for hc in table_obj.header.cells]
            all_y0 = sorted(set(round(c[1], 0) for c in table_obj.cells))
            all_y1 = sorted(set(round(c[3], 0) for c in table_obj.cells))
            row_ys = [(all_y0[i], all_y1[i]) for i in range(min(len(all_y0), len(all_y1)))]

            patched = []
            for ri, row in enumerate(table_data):
                patched_row = []
                for ci, cell in enumerate(row):
                    if cell is None and ri < len(row_ys) and ci < len(col_xs):
                        cy0, cy1 = row_ys[ri]
                        cx0, cx1 = col_xs[ci]
                        cell_words = [
                            w[4] for w in words
                            if cx0 - 2 <= w[0] and w[2] <= cx1 + 2
                            and cy0 - 2 <= w[1] and w[3] <= cy1 + 2
                        ]
                        patched_row.append(" ".join(cell_words) if cell_words else None)
                    else:
                        patched_row.append(cell)
                patched.append(patched_row)
            table_data = patched
        except Exception:
            pass

    cleaned_rows = []
    for row in table_data:
        cleaned_row = [
            re.sub(r'\s+', ' ', str(cell).strip()) if cell else ""
            for cell in row
        ]
        if any(c for c in cleaned_row):
            cleaned_rows.append(cleaned_row)

    if not cleaned_rows:
        return ""

    total_cells = sum(len(row) for row in cleaned_rows)
    non_empty_cells = [c for row in cleaned_rows for c in row if c]
    empty_ratio = (total_cells - len(non_empty_cells)) / total_cells if total_cells else 0
    content_len = sum(len(c) for c in non_empty_cells)

    if (
        len(cleaned_rows) <= 2
        and len(non_empty_cells) <= 3
        and empty_ratio >= 0.3
        and content_len <= 60
    ):
        return " ".join(non_empty_cells)

    header_row = cleaned_rows[0]
    prev_ff = [""] * len(header_row)
    ffilled = [header_row[:]]
    for row in cleaned_rows[1:]:
        filled = []
        for j, cell in enumerate(row):
            if cell == "" and j < len(prev_ff) and prev_ff[j] != "":
                filled.append(prev_ff[j])
            else:
                filled.append(cell)
        ffilled.append(filled)
        for j, cell in enumerate(filled):
            if cell != "":
                prev_ff[j] = cell
    cleaned_rows = ffilled

    lines = ["[표]"]
    for i, row in enumerate(cleaned_rows):
        lines.append("| " + " | ".join(row) + " |")
        if i == 0:
            lines.append("| " + " | ".join(["---"] * len(row)) + " |")

    return "\n".join(lines)


# ============================================================================
# 파일 파싱 (PDF / DOCX / TXT)
# ============================================================================

def extract_text_by_page(file_content: bytes, filename: str) -> List[Dict[str, Any]]:
    """파일 확장자에 따라 텍스트 및 메타데이터 추출 (폰트/위치 정보 포함)."""
    ext = filename.split('.')[-1].lower()
    results = []

    try:
        if ext == 'pdf':
            doc = fitz.open(stream=file_content, filetype="pdf")
            for page_index, page in enumerate(doc):
                page_num = page_index + 1
                page_dict = page.get_text("rawdict")
                blocks = page_dict.get("blocks", [])
                blocks.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
                page_height = page.rect.height

                try:
                    page_tables = page.find_tables()
                    table_list = page_tables.tables if page_tables else []
                except Exception:
                    table_list = []

                table_bboxes = [t.bbox for t in table_list]
                page_items = []  # (y_pos, text, block_dict)

                for t in table_list:
                    ty0, ty1 = t.bbox[1], t.bbox[3]
                    if ty0 < page_height * 0.05 or ty1 > page_height * 0.92:
                        continue
                    table_text = format_table_as_text(t.extract(), page=page, table_obj=t)
                    if table_text:
                        page_items.append((ty0, table_text, {
                            "text": table_text,
                            "font_size": 9.0,
                            "bbox": list(t.bbox),
                            "page": page_num,
                            "is_table": True,
                        }))

                for b in blocks:
                    if b["type"] != 0:
                        continue
                    y0, y1 = b["bbox"][1], b["bbox"][3]
                    if y0 < page_height * 0.05 or y1 > page_height * 0.92:
                        continue
                    if table_bboxes and is_inside_table(b["bbox"], table_bboxes):
                        continue

                    block_lines = []
                    max_font_size = 0
                    for line in b["lines"]:
                        line_text = ""
                        prev_x = None
                        for span in line["spans"]:
                            if prev_x is not None and span["bbox"][0] - prev_x > 20:
                                line_text += " | "
                            line_text += _span_text_with_spaces(span)
                            max_font_size = max(max_font_size, span["size"])
                            prev_x = span["bbox"][2]
                        block_lines.append(line_text)

                    block_text = "\n".join(block_lines)
                    normalized_block = normalize_text(block_text)
                    if normalized_block:
                        page_items.append((y0, normalized_block, {
                            "text": normalized_block,
                            "font_size": max_font_size,
                            "bbox": b["bbox"],
                            "page": page_num,
                        }))

                page_items.sort(key=lambda x: x[0])

                # 블록 분리 보정:
                # ① 괄호형 영문 용어: "ROI\n(Return on Investment)" → 이전 블록에 병합
                #    패턴 A: 블록이 "(영문자..." 로 시작 (여는 괄호형)
                #    패턴 B: 블록이 "영문대소문자+)..." 로 시작 (닫는 괄호형)
                # ② 한국어 어미/조사 절단: PyMuPDF가 시각적 줄바꿈 경계를
                #    블록으로 분리할 때 "하여야 한" + "니 된다." 처럼
                #    어절 중간에서 잘리는 경우. 직전 블록이 한글로 끝나고
                #    현 블록이 1-4자 한글 + 구두점/공백으로 시작하면 병합.
                _PAREN_CONT = re.compile(r'^(\([A-Za-z]|[A-Z][a-z]+\))')
                # ② 패턴 개선:
                #  - 1-4자 한글 + 구두점/공백 OR 문자열 끝 (단독 음절 "발" 등 포함)
                _KOR_CONT   = re.compile(r'^[가-힣]{1,4}(?:[\s.,。;!?]|$)')
                #  - 한글 뒤에 원형 번호/공백이 오는 경우도 허용
                #    예: "알고리즘개 ③" → 끝이 한글이 아니지만 절단된 케이스
                _KOR_TAIL   = re.compile(r'[가-힣][\s\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]*$')
                merged_items: list = []
                for item in page_items:
                    y_pos, text, block_dict = item
                    stripped = text.strip()
                    if merged_items and not block_dict.get("is_table"):
                        py, prev_text, prev_block = merged_items[-1]
                        is_paren = _PAREN_CONT.match(stripped)
                        is_kor = (
                            _KOR_CONT.match(stripped)
                            and _KOR_TAIL.search(prev_text.rstrip())
                        )
                        if is_kor:
                            prev_y1   = prev_block.get("bbox", [0, 0, 0, 0])[3]
                            y_gap_val = y_pos - prev_y1
                            prev_font = prev_block.get("font_size", 10.0)
                            cur_font  = block_dict.get("font_size", 10.0)
                            font_diff = abs(prev_font - cur_font)
                            if y_gap_val > 15.0 and font_diff > 1.5:
                                is_kor = False  # heading+본문 오병합 방지
                        if is_paren or is_kor:
                            prev_stripped = prev_text.rstrip()
                            if is_kor:
                                # 원형 번호가 끝에 붙은 경우: 번호 앞에 음절 삽입
                                # "알고리즘개 ③" + "발" → "알고리즘개발 ③"
                                circle_m = re.search(
                                    r'([\s\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]+)$',
                                    prev_stripped,
                                )
                                if circle_m:
                                    base = prev_stripped[:circle_m.start()]
                                    joined = base + stripped + circle_m.group(0)
                                else:
                                    joined = prev_stripped + stripped
                            else:
                                # 괄호형은 공백 삽입
                                joined = prev_stripped + " " + stripped
                            merged_items[-1] = (py, joined, {**prev_block, "text": joined})
                            continue
                    merged_items.append(item)
                page_items = merged_items

                blocks_data = [item[2] for item in page_items]
                page_text_parts = [item[1] for item in page_items]
                page_full_text = "\n\n".join(page_text_parts)

                if page_num <= 2 and is_toc_chunk(page_full_text):
                    logger.info(f"[Page {page_num}] TOC page detected and skipped.")
                    continue

                if page_text_parts:
                    results.append({
                        "text": page_full_text,
                        "page": page_index + 1,
                        "blocks": blocks_data,
                    })
            doc.close()

        elif ext in ['doc', 'docx']:
            doc = Document(io.BytesIO(file_content))
            WNS    = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            MC_NS  = "http://schemas.openxmlformats.org/markup-compatibility/2006"
            _FALLBACK_TAG = f"{{{MC_NS}}}Fallback"
            _WNS_T        = f"{{{WNS}}}t"

            def _iter_t(elm):
                """w:t 노드 수집 — mc:Fallback 하위 트리 제외.
                mc:AlternateContent 는 Choice(현대 Word)와 Fallback(구버전 호환)을
                동시에 포함하므로, Fallback을 건너뛰어 텍스트 중복을 방지한다.
                """
                for child in elm:
                    if child.tag == _FALLBACK_TAG:
                        continue
                    if child.tag == _WNS_T:
                        yield child
                    yield from _iter_t(child)

            def _cell_text(cell_elm) -> str:
                """셀 내 단락(w:p)별로 정규화 후 병합.
                멀티-단락 셀의 구조를 보존하며, 라벨(≤20자)+값(≤30자) 쌍은 공백으로 합침.
                Fallback 중복 방지를 위해 _iter_t() 사용.
                """
                paragraphs = []
                for p in cell_elm.findall(f"{{{WNS}}}p"):
                    raw = "".join(node.text or "" for node in _iter_t(p))
                    normed = normalize_text(raw.strip())
                    if normed:
                        paragraphs.append(normed)
                # 연속하는 짧은 단락(라벨+값 형태)은 공백으로 합침
                merged: list = []
                for para in paragraphs:
                    if merged and len(merged[-1]) <= 20 and len(para) <= 30:
                        merged[-1] = merged[-1] + " " + para
                    else:
                        merged.append(para)
                return " ".join(merged) if merged else ""

            def _extract_table(tbl_elm) -> str:
                """각 행을 '| cell | cell |' 형태로 변환.
                행 사이를 \\n\\n으로 구분해 RecursiveCharacterTextSplitter가
                행 경계에서만 분할하도록 보장.
                """
                rows_text = []
                for tr in tbl_elm.findall(f"{{{WNS}}}tr"):
                    cells = []
                    seen: set = set()
                    for tc in tr.findall(f"{{{WNS}}}tc"):
                        ct = _cell_text(tc).strip()
                        if ct and ct not in seen:
                            seen.add(ct)
                            cells.append(ct)
                    if cells:
                        rows_text.append("| " + " | ".join(cells) + " |")
                return "\n\n".join(rows_text)

            blocks = []
            for idx, child in enumerate(doc.element.body):
                local = child.tag.split('}')[-1] if '}' in child.tag else child.tag

                if local == 'p':
                    raw = "".join(node.text or "" for node in _iter_t(child))
                    text = normalize_text(raw)
                    if not text.strip():
                        continue
                    ppr = child.find(f"{{{WNS}}}pPr")
                    pstyle = ppr.find(f"{{{WNS}}}pStyle") if ppr is not None else None
                    sval = (pstyle.get(f"{{{WNS}}}val") or "").lower() if pstyle is not None else ""
                    if "heading1" in sval or sval == "1":
                        font_size = 18.0
                    elif "heading2" in sval or sval == "2":
                        font_size = 16.0
                    elif "heading3" in sval or sval == "3":
                        font_size = 14.0
                    elif "heading" in sval:
                        font_size = 13.0
                    else:
                        sz = child.find(f".//{{{WNS}}}sz")
                        font_size = int(sz.get(f"{{{WNS}}}val", "22")) / 2 if sz is not None else 11.0
                    blocks.append({
                        "text": text,
                        "font_size": font_size,
                        "bbox": [0, idx * 20, 500, idx * 20 + 18],
                        "page": 1,
                    })

                elif local == 'tbl':
                    table_text = _extract_table(child)
                    if table_text.strip():
                        blocks.append({
                            "text": table_text,
                            "font_size": 10.0,
                            "bbox": [0, idx * 20, 500, idx * 20 + 18],
                            "page": 1,
                            "is_table": True,
                        })

            full_text = "\n\n".join(b["text"] for b in blocks)
            results = [{"text": full_text, "page": 1, "blocks": blocks}]

        elif ext in ['txt', 'md']:
            full_text = normalize_text(file_content.decode('utf-8'))
            results = [{"text": full_text, "page": 1, "blocks": []}]

        else:
            raise ValueError(f"지원하지 않는 파일 형식입니다: {ext}")

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Text extraction failed for {filename}: {e}")
        raise ValueError(f"텍스트 추출 중 오류가 발생했습니다: {str(e)}")

    return results


# ============================================================================
# 청킹 파이프라인 헬퍼 (splitter factory + block-aware chunker)
# ============================================================================

def make_splitter(chunk_size: int = 1000, chunk_overlap: int = 50) -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=[
            "\n\n",        # 문단 구분 (최우선)
            "한다.\n",      # 법조문 문장 종결 (줄바꿈 동반)
            "이다.\n",      # 정의 조항 종결 (줄바꿈 동반)
            "\n- ",        # 목록
            "\n",          # 줄바꿈
        ],
    )


# 법조문 경계 패턴
_LAW_ARTICLE_RE = re.compile(r'^제\s*\d+조')                        # 제X조
_LAW_CLAUSE_RE  = re.compile(r'^[\u2460-\u2473\u24EA\u3251-\u325F]')  # ①-⑳, ㊑-㊟


def chunk_blocks_aware(
    blocks: List[Dict[str, Any]],
    max_chars: int = 900,
    min_chars: int = 150,
) -> List[str]:
    """
    블록 경계를 보존하는 청킹 — RecursiveCharacterTextSplitter 대체.

    분리 우선순위:
    1. 제X조 시작: 항상 새 청크 (조항 단위 보장)
    2. ①②③ 시작: 현재 청크 >= min_chars 이면 새 청크 (항 단위 분리)
    3. max_chars 초과: 다음 블록 경계에서 분리 (문장 중간 컷 없음)

    RecursiveCharacterTextSplitter와 달리 문자 단위 강제 컷이 없으므로
    블록(PDF 텍스트 유닛) 경계에서만 분리 → 문장 항상 완전 보존.
    """
    # 서술어 끝 조각 패턴: "말한다.", "한다.", "이다." 등 단독으로 의미 없는 짧은 조각
    _TAIL_FRAG_RE = re.compile(
        r'^[가-힣]{1,6}(한다|된다|이다|있다|없다|말한다|아니한다|합니다|됩니다)[.。]?\s*$'
    )

    chunks: List[str] = []
    buf: List[str] = []
    buf_chars: int = 0

    def _flush() -> None:
        nonlocal buf, buf_chars
        text = "\n".join(buf).strip()
        if not text:
            buf.clear(); buf_chars = 0; return
        # 짧은 서술어 조각(≤40자)은 이전 청크 뒤에 붙임 (다음 청크 오염 방지)
        if buf_chars <= 40 and chunks and _TAIL_FRAG_RE.search(text):
            chunks[-1] = chunks[-1] + "\n" + text
        else:
            chunks.append(text)
        buf.clear()
        buf_chars = 0

    for block in blocks:
        text = block.get("text", "").strip()
        if not text:
            continue

        is_article = bool(_LAW_ARTICLE_RE.match(text))
        is_clause  = bool(_LAW_CLAUSE_RE.match(text))

        if is_article and buf:
            _flush()
        elif is_clause and buf_chars >= min_chars:
            _flush()
        elif buf_chars + len(text) > max_chars and buf:
            _flush()

        buf.append(text)
        buf_chars += len(text) + 1  # +1 for \n separator

    _flush()
    return chunks


# 법조문 서술어 조각 패턴 (청크 시작에 남는 잔여 서술어 + 마침표까지 포함)
_LEADING_FRAGMENT_RE = re.compile(
    r'^(한다|했다|된다|됩니다|합니다|하였다|하였습니다|이다|있다|없다|않는다|아니다)[.。]?\s*',
)


def strip_leading_fragment(text: str) -> str:
    """청크 시작의 서술어 조각(예: '한다. 다만...') 제거.
    마침표까지 함께 제거하여 '다만, ...'처럼 깔끔하게 시작하도록 함.
    제거 후 30자 미만이면 원본 유지 (의미있는 내용 손실 방지).
    """
    cleaned = _LEADING_FRAGMENT_RE.sub('', text).strip()
    return cleaned if len(cleaned) >= 30 else text
