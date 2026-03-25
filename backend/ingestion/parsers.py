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


# ============================================================================
# 섹션 감지 & 구조화
# ============================================================================

def detect_section_level(title: str) -> Optional[int]:
    """제목 패턴을 분석하여 섹션 레벨 반환 (1, 2, 3...)"""
    patterns = [
        (r'^[0-9]+\.[0-9]+\.[0-9]+', 3),
        (r'^[0-9]+\.[0-9]+', 2),
        (r'^[0-9]+\.', 1),
        (r'^제\s*[0-9]+\s*장', 1),
        (r'^제\s*[0-9]+\s*절', 2),
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
        r'^\d+\.',
        r'^\d+\.\d+(\.\d+)?',
        r'^부\s*칙',
    ]

    is_pattern_match = any(re.match(p, clean_text) for p in heading_patterns)
    is_font_boost = font_size > prev_font_size + 1.5 and font_size > 11.0

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

def _merge_short_chunks(chunks: list, min_chars: int = 200, max_chars: int = 1200) -> list:
    """같은 섹션 내 min_chars 미만 청크를 인접 청크와 병합 (최대 max_chars까지)."""
    if not chunks:
        return chunks
    merged = []
    buf = chunks[0]
    for chunk in chunks[1:]:
        if len(buf) < min_chars and len(buf) + len(chunk) <= max_chars:
            buf = buf + "\n" + chunk
        else:
            merged.append(buf)
            buf = chunk
    merged.append(buf)
    return merged


def detect_repeated_headers(pages: List[Dict[str, Any]], threshold: int = 3) -> set:
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


def strip_redundant_headings(chunk_text: str, section_title: str) -> str:
    """청크에서 이미 metadata에 포함된 section heading 라인 제거."""
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


def extract_keywords(text: str, top_n: int = 5) -> List[str]:
    """간이 빈도 기반 키워드 추출 (불용어 제외)."""
    words = re.findall(r'[가-힣]{2,}', text)
    if not words:
        return []
    counts = Counter(words)
    return [w for w, _ in counts.most_common(top_n)]


def build_context_prefix(filename: str, section_path: str, page: int) -> str:
    """RAG 검색 품질 향상을 위한 표준 컨텍스트 프리픽스."""
    return f"문서: {filename}\n섹션: {section_path}\n페이지: {page}\n\n"


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
                page_dict = page.get_text("dict")
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
                    if ty0 < page_height * 0.08 or ty1 > page_height * 0.92:
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
                    if y0 < page_height * 0.08 or y1 > page_height * 0.92:
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
                            line_text += span["text"]
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
            WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

            def _cell_text(cell_elm) -> str:
                return normalize_text(
                    "".join(node.text or "" for node in cell_elm.iter() if node.tag == f"{{{WNS}}}t")
                )

            def _extract_table(tbl_elm) -> str:
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
                return "\n".join(rows_text)

            blocks = []
            for idx, child in enumerate(doc.element.body):
                local = child.tag.split('}')[-1] if '}' in child.tag else child.tag

                if local == 'p':
                    raw = "".join(
                        node.text or "" for node in child.iter()
                        if node.tag == f"{{{WNS}}}t"
                    )
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
# 청킹 파이프라인 헬퍼 (splitter factory)
# ============================================================================

def make_splitter(chunk_size: int = 1200, chunk_overlap: int = 300) -> RecursiveCharacterTextSplitter:
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
