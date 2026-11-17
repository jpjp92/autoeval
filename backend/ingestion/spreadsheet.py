"""
ingestion/spreadsheet.py

xlsx / xlsm / csv 를 표 블록으로 바꾼다.

엑셀은 내용 전체가 표이므로 LLM 산문화를 거치지 않는다. 출력 블록은 PDF 표와 같은
"[표] 제목\n| 머리글 |\n| --- |\n| 행 |" 형식이고, 청킹은 chunker.ingest_with_table_chunking 이 맡는다.

- 시트 1개 = page 1개 (숨김 시트 제외)
- 시트 안에서 빈 행·빈 열로 나뉜 덩어리를 각각 표로 본다. 값이 2칸 이하인 덩어리는 다음 표의 제목.
- 병합 칸은 범위 전체에 왼쪽 위 값을 채운다(2단 머리글 유지).
- 숫자·날짜는 칸 서식(number_format)대로 문자열로 바꾼다. 0.123 + "0.0%" → "12.3%".
- 수식 칸은 저장된 계산값을 쓴다. 계산값이 없으면 빈칸이 되고 경고를 남긴다.
- 행 상한: 시트당 MAX_ROWS_PER_SHEET, 문서당 MAX_ROWS_PER_DOC. 넘는 행은 읽지 않고 기록한다.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import logging
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("autoeval.ingestion.spreadsheet")

MAX_ROWS_PER_SHEET = 2000
MAX_ROWS_PER_DOC = 20000
SPREADSHEET_EXTS = ("xlsx", "xlsm", "csv")

Grid = List[List[str]]
# 표 덩어리: (시트 안 시작 행, 시작 열, 칸 문자열)
Region = Tuple[int, int, Grid]


# ── 값 표시 ────────────────────────────────────────────────────────────────

def _decimals(fmt: str) -> Optional[int]:
    """'0.00%' → 2, '#,##0' → 0. 소수 자릿수를 알 수 없으면 None."""
    m = re.search(r"0(?:\.(0+))?", fmt)
    if not m:
        return None
    return len(m.group(1) or "")


def _round(value: float, d: int) -> Decimal:
    """엑셀과 같은 사사오입(0.5 → 올림). 파이썬 기본 반올림은 은행원 방식이라 다르다."""
    return Decimal(repr(value)).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)


def format_value(value: Any, number_format: str = "General") -> str:
    """칸 값을 엑셀 화면과 같은 문자열로."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, dt.datetime):
        if value.time() == dt.time(0, 0):
            return value.date().isoformat()
        return value.isoformat(sep=" ", timespec="minutes")
    if isinstance(value, (dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, (int, float)):
        fmt = (number_format or "General").split(";")[0]   # 양수 서식만 본다
        d = _decimals(fmt)
        if "%" in fmt:
            return f"{_round(value * 100, d if d is not None else 0)}%"
        if fmt == "General" or d is None:
            if isinstance(value, float) and value.is_integer():
                return str(int(value))
            return format(value, ".15g") if isinstance(value, float) else str(value)
        if "," in fmt:
            return f"{_round(value, d):,}"
        return f"{_round(value, d)}"
    return re.sub(r"\s+", " ", str(value)).strip()


# ── 표 영역 나누기 ──────────────────────────────────────────────────────────

def _split_runs(flags: List[bool]) -> List[Tuple[int, int]]:
    """True(값 있음)가 이어지는 구간 [(start, end_exclusive)]."""
    runs, start = [], None
    for i, f in enumerate(flags + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            runs.append((start, i))
            start = None
    return runs


def find_regions(grid: Grid, r_off: int = 0, c_off: int = 0, by_rows: bool = True) -> List[Region]:
    """빈 행과 빈 열로 번갈아 나눠, 더 나눌 수 없는 덩어리를 위→아래, 왼→오 순서로 돌려준다.

    빈 행으로만 나누면 옆에 나란한 표가 왼쪽 표의 행 범위를 물려받아 빈 행이 붙는다.
    그래서 열로 나눈 덩어리를 다시 행으로 나누는 식으로 반복한다.
    """
    if not grid:
        return []
    width = max(len(r) for r in grid)
    grid = [r + [""] * (width - len(r)) for r in grid]
    if by_rows:
        runs = _split_runs([any(c for c in row) for row in grid])
        pieces = [(r0, 0, [row[:] for row in grid[r0:r1]]) for r0, r1 in runs]
    else:
        runs = _split_runs([any(r[c] for r in grid) for c in range(width)])
        pieces = [(0, c0, [r[c0:c1] for r in grid]) for c0, c1 in runs]
    if len(pieces) == 1 and pieces[0][2] == grid:
        if by_rows:   # 행으로는 더 안 나뉨 — 열로 시도
            return find_regions(grid, r_off, c_off, by_rows=False)
        return [(r_off, c_off, grid)]
    regions: List[Region] = []
    for dr, dc, piece in pieces:
        regions.extend(find_regions(piece, r_off + dr, c_off + dc, by_rows=not by_rows))
    return regions


def _non_empty(region: Grid) -> List[str]:
    return [c for row in region for c in row if c]


def _header_rows(r0: int, c0: int, region: Grid, merges: List[Tuple[int, int, int, int]]) -> int:
    """머리글 행 수. 덩어리 첫 행에서 시작하는 세로 병합이 있으면 그 아래 행까지 머리글로 본다."""
    width = len(region[0]) if region else 0
    n = 1
    for mr0, mc0, mr1, mc1 in merges:   # 0-based, end inclusive
        if mr0 == r0 and c0 <= mc0 < c0 + width and mr1 > mr0:
            n = max(n, mr1 - r0 + 1)
    return min(n, max(len(region) - 1, 1))


def regions_to_blocks(regions: List[Region], sheet: str, page: int,
                      merges: Optional[List[Tuple[int, int, int, int]]] = None) -> List[Dict[str, Any]]:
    """표 덩어리를 [표] 블록으로. 값이 2칸 이하인 덩어리는 다음 표의 제목으로 쓴다.

    2단 머리글: 첫 행 + 구분선 뒤에 나머지 머리글 행을 두고, 세로 병합으로 채워진 칸은 비운다.
    (PDF 표와 같은 형식 — split_large_table_text 가 조각마다 머리글로 반복한다.)
    """
    merges = merges or []
    vertical = {(r, c) for mr0, mc0, mr1, mc1 in merges for r in range(mr0 + 1, mr1 + 1)
                for c in range(mc0, mc1 + 1)}
    blocks: List[Dict[str, Any]] = []
    caption = ""
    for r0, c0, region in regions:
        cells = _non_empty(region)
        if len(cells) <= 2 or len(region) == 1 and len(region[0]) <= 2:
            caption = " ".join(cells)[:60]
            continue
        title = " · ".join(p for p in (sheet, caption) if p)
        n_head = _header_rows(r0, c0, region, merges)
        header = region[0]
        sub_headers = [
            ["" if (r0 + i, c0 + j) in vertical else v for j, v in enumerate(row)]
            for i, row in enumerate(region[1:n_head], 1)
        ]
        for row in sub_headers:   # split_large_table_text 가 머리글로 알아보도록 첫 칸은 비운다
            row[0] = "" if row and row[0] == header[0] else row[0]
        body = region[n_head:]
        lines = [f"[표] {title}".rstrip(), "| " + " | ".join(header) + " |",
                 "| " + " | ".join(["---"] * len(header)) + " |"]
        lines += ["| " + " | ".join(r) + " |" for r in sub_headers + body]
        blocks.append({
            "text": "\n".join(lines),
            "font_size": 10.0,
            "bbox": [0, len(blocks) * 20, 500, len(blocks) * 20 + 18],
            "page": page,
            "is_table": True,
            "sheet": sheet,
        })
        caption = ""
    if caption:   # 표 없이 끝난 메모
        blocks.append({"text": caption, "font_size": 10.0, "bbox": [0, 0, 500, 18], "page": page, "sheet": sheet})
    return blocks


# ── xlsx / csv ─────────────────────────────────────────────────────────────

def _xlsx_grids(content: bytes) -> Tuple[List[Tuple[str, Grid, int, list]], Dict[str, int]]:
    """[(sheet, grid, truncated_rows, merges)], stats. merges = [(r0, c0, r1, c1)] 0-based, 끝 포함."""
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(content), data_only=True)
    try:
        wb_formula = load_workbook(io.BytesIO(content), data_only=False)
    except Exception:
        wb_formula = None
    stats = {"sheets": 0, "hidden_sheets": 0, "rows": 0, "truncated_rows": 0, "missing_formula_values": 0}
    out: List[Tuple[str, Grid, int, list]] = []
    budget = MAX_ROWS_PER_DOC
    for ws in wb.worksheets:
        if ws.sheet_state != "visible":
            stats["hidden_sheets"] += 1
            continue
        stats["sheets"] += 1
        max_row = ws.max_row or 0
        keep = min(max_row, MAX_ROWS_PER_SHEET, max(budget, 0))
        truncated = max_row - keep
        budget -= keep
        grid: Grid = []
        for row in ws.iter_rows(min_row=1, max_row=keep):
            grid.append([format_value(c.value, c.number_format) for c in row])
        # 병합 칸 채우기
        merges = [(m.min_row - 1, m.min_col - 1, m.max_row - 1, m.max_col - 1) for m in ws.merged_cells.ranges]
        for rng in ws.merged_cells.ranges:
            r0, c0 = rng.min_row - 1, rng.min_col - 1
            if r0 >= len(grid) or c0 >= len(grid[r0]):
                continue
            v = grid[r0][c0]
            for r in range(r0, min(rng.max_row, len(grid))):
                for c in range(c0, min(rng.max_col, len(grid[r]))):
                    grid[r][c] = v
        # 계산값 없는 수식 칸
        if wb_formula is not None:
            wf = wb_formula[ws.title]
            for row in wf.iter_rows(min_row=1, max_row=keep):
                for c in row:
                    if isinstance(c.value, str) and c.value.startswith("=") and not grid[c.row - 1][c.column - 1]:
                        stats["missing_formula_values"] += 1
        stats["rows"] += keep
        stats["truncated_rows"] += truncated
        out.append((ws.title, grid, truncated, merges))
    return out, stats


def _decode_csv(content: bytes) -> str:
    for enc in ("utf-8-sig", "cp949"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _csv_grid(content: bytes) -> Tuple[Grid, int]:
    text = _decode_csv(content)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = [[re.sub(r"\s+", " ", c).strip() for c in r] for r in csv.reader(io.StringIO(text), dialect)]
    keep = min(len(rows), MAX_ROWS_PER_SHEET)
    return rows[:keep], len(rows) - keep


def extract_spreadsheet(content: bytes, filename: str) -> List[Dict[str, Any]]:
    """extract_text_by_page 와 같은 형식의 page 목록. 각 page에 "sheet", "truncated_rows"를 더한다."""
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "csv":
        grid, truncated = _csv_grid(content)
        sheets = [(filename.rsplit(".", 1)[0], grid, truncated, [])]
        stats = {"sheets": 1, "hidden_sheets": 0, "rows": len(grid), "truncated_rows": truncated, "missing_formula_values": 0}
    else:
        sheets, stats = _xlsx_grids(content)

    pages: List[Dict[str, Any]] = []
    for i, (sheet, grid, truncated, merges) in enumerate(sheets, 1):
        blocks = regions_to_blocks(find_regions(grid), sheet, i, merges)
        if not blocks:
            continue
        pages.append({
            "text": "\n\n".join(b["text"] for b in blocks),
            "page": i,
            "blocks": blocks,
            "sheet": sheet,
            "truncated_rows": truncated,
        })
    logger.info(f"[{filename}] spreadsheet: {stats}")
    if stats["truncated_rows"]:
        logger.warning(f"[{filename}] {stats['truncated_rows']} rows over the limit were not read")
    if stats["missing_formula_values"]:
        logger.warning(f"[{filename}] {stats['missing_formula_values']} formula cells have no saved value (empty)")
    return pages
