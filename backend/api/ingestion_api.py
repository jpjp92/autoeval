"""
Ingestion API  —  POST /api/ingestion/*

문서(PDF/DOCX) 업로드 → 청킹 → Gemini Embedding 2 벡터화 → Supabase doc_chunks 저장
및 hierarchy(L1/L2/L3) 분석·태깅 엔드포인트를 제공한다.

---

엔드포인트
  POST /api/ingestion/upload
      PDF/DOCX 파일 수신 → extract_text_by_page() 파싱 → process_and_ingest() 청킹 + 임베딩 + 저장
      content_hash 기반 중복 청크 INSERT skip

  POST /api/ingestion/analyze-hierarchy
      업로드된 문서의 chunk content 샘플 → LLM(Gemini) → L1 후보 + 계층 제안 반환

  POST /api/ingestion/analyze-tagging-samples
      selected_l1_list 기반으로 L2/L3 AI 태깅 샘플 미리보기 생성

  POST /api/ingestion/apply-granular-tagging
      AI 태깅 결과를 doc_chunks.metadata(hierarchy_l1/l2/l3)에 일괄 적용 (BackgroundTask)

  POST /api/ingestion/update-hierarchy
      단일 청크 계층 수동 업데이트

  GET  /api/ingestion/hierarchy-list
      doc_chunks에 저장된 L1/L2 고유 목록 반환 (프론트엔드 드롭다운용)

  GET  /api/ingestion/test
      라우터 헬스체크

---

핵심 파싱 파이프라인 (extract_text_by_page → process_and_ingest)
  PyMuPDF(fitz) 기반 블록 추출
  → detect_heading / detect_section_level 로 섹션 구조 파악
  → build_sections 로 section-first 청크 후보 구성
  → RecursiveCharacterTextSplitter 적용
  → _merge_short_chunks (min 200자) / _is_colophon_chunk skip
  → normalize_text (Ÿ 정규화, _smart_join_lines 줄바꿈 결합)
  → Gemini Embedding 2 (1536dim, L2 정규화) 벡터화
  → Supabase doc_chunks upsert (content_hash 중복 방지)
"""

import asyncio
import os
import json
import logging
import io
import re
import hashlib
import numpy as np
from datetime import datetime
from uuid import uuid4
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Form
from pydantic import BaseModel
from pathlib import Path

# Document Parsers
import fitz  # PyMuPDF
from docx import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Embedding & Supabase
from google import genai as google_genai
from config.supabase_client import (
    save_doc_chunk, 
    is_supabase_available,
    get_document_chunks,
    update_document_hierarchy,
    get_hierarchy_list
)

logger = logging.getLogger("autoeval.ingestion")

router = APIRouter(prefix="/api/ingestion", tags=["ingestion"])

# Initialize Gemini Client for Embeddings
GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY")
gemini_client = google_genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

class IngestionResponse(BaseModel):
    success: bool
    message: str
    file_name: str = ""

class HierarchyAnalysisRequest(BaseModel):
    filename: str

class HierarchyAnalysisResponse(BaseModel):
    domain_analysis: str
    l1_candidates: List[str]
    suggested_hierarchy: Dict[str, str] # Default sample
    validation: str

class GranularTaggingRequest(BaseModel):
    filename: str
    selected_l1_list: List[str]
    l2_l3_master: Optional[Dict[str, Dict[str, List[str]]]] = None  # {L1: {L2: [L3, ...]}}

class L2L3AnalysisRequest(BaseModel):
    filename: str
    selected_l1_list: List[str]

class L2L3AnalysisResponse(BaseModel):
    l2_l3_master: Dict[str, Any]  # {L1: {L2: [L3, ...]}}

class TaggingSample(BaseModel):
    id: str
    content_preview: str
    hierarchy: Dict[str, str]

class TaggingPreviewResponse(BaseModel):
    samples: List[TaggingSample]

def normalize_for_hash(text: str) -> str:
    """중복 제거를 위한 강력한 정규화 (소문자화, 공백/특수문자 제거)"""
    text = text.lower()
    text = re.sub(r'\s+', '', text)
    text = re.sub(r'[^\w가-힣]', '', text)
    return text

def detect_section_level(title: str) -> Optional[int]:
    """제목 패턴을 분석하여 섹션 레벨 반환 (1, 2, 3...)"""
    patterns = [
        (r'^[0-9]+\.[0-9]+\.[0-9]+', 3),  # 1.1.1
        (r'^[0-9]+\.[0-9]+', 2),           # 1.1
        (r'^[0-9]+\.', 1),                 # 1.
        (r'^제\s*[0-9]+\s*장', 1),          # 제 1 장
        (r'^제\s*[0-9]+\s*절', 2),          # 제 1 절
        (r'^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]', 1),      # Ⅰ Ⅱ Ⅲ 로마 숫자 최상위
        (r'^\[[^\]]{2,}\]', 1),            # [제2권] 같은 꺾쇠 헤딩 → L1
        (r'^\d+\s+\S', 2),                 # 1 작성 배경, 2 목적 → L2
    ]
    for pattern, level in patterns:
        if re.match(pattern, title.strip()):
            return level
    return None

def detect_chunk_type(text: str) -> str:
    """청크의 내품 구조를 분석하여 타입 분류"""
    lines = text.strip().split('\n')
    if len(text) < 150 and not text.strip().startswith("- "):
        return "Heading"
    if any(line.strip().startswith("- ") for line in lines[:2]):
        return "List"
    if "|" in text and "-" in text: # 표 구분자 존재 확인
        return "Table"
    return "Body"

def extract_keywords(text: str, top_n: int = 5) -> List[str]:
    """간이 빈도 기반 키워드 추출 (불용어 제외)"""
    words = re.findall(r'[가-힣]{2,}', text) # 2글자 이상 한글만
    if not words:
        return []
    from collections import Counter
    counts = Counter(words)
    return [w for w, _ in counts.most_common(top_n)]

def build_contextual_text(filename: str, section_path: str, page: int, text: str) -> str:
    """임베딩 품질 향상을 위한 구조화된 컨텍스트 결합"""
    return f"[문서] {filename}\n[섹션] {section_path}\n[페이지] {page}\n\n[내용]\n{text}"

def detect_heading(text: str, font_size: float, prev_font_size: float) -> Optional[str]:
    """
    제목(Heading) 감지 로직 강화 (Phase 2.4)
    - 목차의 잔해(점선 등)가 포함된 경우 제목에서 제외
    - 특정 패턴(제1장, 1.1 등) 및 폰트 크기 변화 감지
    """
    clean_text = text.strip()
    if not clean_text or len(clean_text) > 100:
        return None

    # 리스트 bullet(-), 숫자 bullet(•, Ÿ) 로 시작하는 텍스트는 헤딩 아님
    if re.match(r'^[-•ŸŸ∙]\s', clean_text):
        return None

    # 🟢 Phase 2.13: Heading-level TOC 필터 제거
    # Reason: Over-filters legitimate sections; Page-level (1-2 skip) 충분
    # False positives 제거 → 정상 콘텐츠 누락 방지

    # 목차 노이즈 (점선, 무의미한 숫자 나열 등) 필터링 강화
    if re.search(r'[·\.]{3,}', clean_text) or re.search(r'\.{5,}', clean_text):
        return None
    
    # 기호 비율이 너무 높은 경우(목차 라인) 제외
    # · (가운뎃점)만 계산 — 짧은 제목(Ⅰ. 서론 등)에서 '. '이 오탐 방지
    if len(clean_text) >= 15:
        symbols = re.findall(r'[·]', clean_text)
        if len(symbols) / len(clean_text) > 0.2:
            return None
        
    heading_patterns = [
        r'^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]',    # Ⅰ. 서론 / Ⅱ. / Ⅲ. (로마 숫자)
        r'^제\s*\d+\s*장',
        r'^제\s*\d+\s*절',
        r'^\d+\.',
        r'^\d+\.\d+(\.\d+)?',
        r'^부\s*칙'
    ]
    
    is_pattern_match = any(re.match(p, clean_text) for p in heading_patterns)
    is_font_boost = font_size > prev_font_size + 1.5 and font_size > 11.0
    
    if is_pattern_match or is_font_boost:
        # 제목이 너무 짧거나(페이지 번호 등) 숫자로만 된 경우 제외
        if len(clean_text) < 2 or clean_text.isdigit():
            return None
        return clean_text
    return None

def build_sections(blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    제목을 기준으로 블록들을 논리적 섹션으로 그룹화 (Phase 2.4)
    """
    sections = []
    current_section = {"heading": "Root", "level": 0, "blocks": [], "page": 1}
    prev_font_size = 10.0
    
    for b in blocks:
        text = b.get("text", "")
        font_size = b.get("font_size", 10.0)
        
        heading = detect_heading(text, font_size, prev_font_size)
        if heading:
            # 이전 섹션 저장
            if current_section["blocks"]:
                sections.append(current_section)
            
            # fallback: 이전 레벨 +1, 단 최대 4로 상한 (무한 증가 방지)
            level = detect_section_level(heading) or min(current_section["level"] + 1, 4)
            current_section = {
                "heading": heading,
                "level": level,
                "blocks": [b],
                "page": b.get("page", 1)
            }
        else:
            current_section["blocks"].append(b)
        
        prev_font_size = font_size
        
    if current_section["blocks"]:
        sections.append(current_section)
    return sections

def build_context_prefix(filename: str, section_path: str, page: int) -> str:
    """RAG 검색 품질 향상을 위한 표준 컨텍스트 프리픽스"""
    return f"문서: {filename}\n섹션: {section_path}\n페이지: {page}\n\n"

def _resolve_chunk_page(chunk_text: str, section_text: str, block_page_offsets: list, default_page: int) -> int:
    """
    청크 텍스트의 실제 페이지를 block offset 역추적으로 계산.
    섹션이 여러 페이지에 걸칠 때 chunk별 정확한 페이지 반환.
    """
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

def is_toc_chunk(text: str) -> bool:
    """
    목차(Table of Contents) 청크인지 판단하는 휴리스틱 (Phase 2.13)

    핵심 원칙: 가운뎃점(·) 을 TOC 신호로 사용 → 마크다운 표 false positive 제거
    - Layer 1: 가운뎃점(·) 밀도 — 표 청크 제외 (셀 내용에 · 구분자 정상 사용)
    - Layer 2: 연속 가운뎃점 패턴 (·····) — TOC 점선 직접 감지
    - Layer 3: 점선 + 페이지번호 라인 비율 — 60% 이상이면 TOC
    """
    if not text or len(text) < 20:
        return False

    # 표 청크 판별 — '|' 파이프가 4개 이상이면 마크다운 표로 간주
    # 표 셀 내용에 · 구분자가 정상적으로 사용될 수 있으므로 Layer 1/3 밀도 체크 제외
    is_table_content = text.count('|') >= 4

    # Layer 1: 가운뎃점(·) 밀도 체크 — 표 청크는 건너뜀 (Phase 2.16 수정)
    if not is_table_content:
        special_dots = text.count('·')
        if special_dots > 10 and special_dots / len(text) > 0.05:
            return True

    # Layer 2: 연속 가운뎃점 4개 이상 → TOC 점선 패턴
    if re.search(r'[·]{4,}', text):
        return True

    # Layer 3: 라인 단위 분석 — 점선 AND 페이지번호 동시 패턴 (표 청크 제외)
    if not is_table_content:
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        if lines:
            toc_lines = 0
            for line in lines:
                has_dots = line.count('·') > 3 or line.count('.') > 5
                has_page_number = any(c.isdigit() for c in line[-5:])
                if has_dots and has_page_number:
                    toc_lines += 1

            # 60% 이상의 라인이 "점선 + 페이지번호" 패턴 → TOC
            if toc_lines / len(lines) >= 0.6:
                return True

    return False

def detect_repeated_headers(pages: List[Dict[str, Any]], threshold: int = 3) -> set:
    """
    여러 페이지에 반복 등장하는 텍스트(header/footer)를 감지 (Phase 2.5)
    - 3페이지 이상에서 동일하게 등장하는 라인을 header/footer로 판단
    - 예: '제2권 AI 데이터 구축 가이드 v3.5' → 모든 청크에서 제거 대상
    """
    from collections import Counter
    line_counter: Counter = Counter()
    for page_data in pages:
        page_text = page_data.get("text", "")
        lines = [l.strip() for l in page_text.split("\n") if l.strip() and len(l.strip()) > 5]
        # 페이지 내 동일 라인 중복 카운트 방지
        for line in set(lines):
            # 마크다운 표 구분선(| --- | --- |)은 반복 헤더 후보에서 제외
            if re.match(r'^[\|\s\-:]+$', line):
                continue
            line_counter[line] += 1
    detected = {line for line, count in line_counter.items() if count >= threshold}
    return detected


def remove_footer_noise(text: str, repeated_headers: set = None) -> str:
    """
    footer/header bleed-through 노이즈 제거 (Phase 2.5)
    - 단독 페이지 번호 줄 제거 (예: '7', '07')
    - 반복 header/footer 텍스트 제거 (detect_repeated_headers 결과 활용)
    """
    lines = text.split("\n")
    cleaned = []
    for line in lines:
        stripped = line.strip()
        # 단독 페이지 번호 제거
        if re.match(r'^\d{1,3}$', stripped):
            continue
        # 반복 header/footer 텍스트 제거
        if repeated_headers and stripped in repeated_headers:
            continue
        cleaned.append(line)
    return "\n".join(cleaned)


def strip_redundant_headings(chunk_text: str, section_title: str) -> str:
    """
    청크에서 이미 metadata에 포함된 section heading 라인 제거 (Phase 2.7)
    
    목적: embedding 입력에 heading 텍스트 중복 제거로 벡터 품질 향상
    예: "작성 배경 및 목적\\n작성 배경\\n- 내용" → "작성 배경\\n- 내용"
    """
    lines = chunk_text.split('\n')
    if not lines:
        return chunk_text
    
    # 첫 줄이 section_title과 정확히 동일한지 확인 (양쪽 공백 제거 후)
    if lines[0].strip() == section_title.strip():
        # 첫 줄 제거
        remaining = '\n'.join(lines[1:]).strip()
        if remaining:
            logger.debug(f"[Heading Strip] Removed duplicate heading: '{section_title}'")
            return remaining
    
    return chunk_text


def merge_adjacent_short_blocks(blocks_data: List[Dict[str, Any]], text_parts: List[str]) -> tuple:
    """
    PDF block split 문제 해결: 짧은 숫자/기호 블록을 다음 블록과 병합 (Phase 2.7)
    
    예: ["1"] + ["작성 배경"] → ["1 작성 배경"]
    목적: subsection 번호 유실 방지 및 섹션 계층 구조 정확성 향상
    
    Returns: (merged_blocks_data, merged_text_parts)
    """
    if not blocks_data or not text_parts:
        return blocks_data, text_parts
    
    merged_blocks = []
    merged_texts = []
    i = 0
    
    while i < len(blocks_data):
        current_block = blocks_data[i]
        current_text = text_parts[i]
        
        # 현재 블록이 짧은 숫자/기호인지 판단
        stripped = current_text.strip()
        is_short_number = (len(stripped) <= 3 and re.match(r'^\d+$', stripped))
        is_short_symbol = (len(stripped) <= 3 and re.match(r'^[•·\-_]+$', stripped))
        
        # 다음 블록이 존재하고, 현재 블록이 짧은 번호/기호라면 병합
        if (is_short_number or is_short_symbol) and i + 1 < len(blocks_data):
            next_block = blocks_data[i + 1]
            next_text = text_parts[i + 1]
            
            # 병합: 현재 + space + 다음
            merged_text = f"{stripped} {next_text.strip()}"
            merged_block = {
                **current_block,
                "text": merged_text,
                # bbox는 [다음 블록의 끝 좌표] 반영하여 범위 확대 (list로 유지)
                "bbox": [current_block["bbox"][0], current_block["bbox"][1], 
                        next_block["bbox"][2], next_block["bbox"][3]]
            }
            
            merged_blocks.append(merged_block)
            merged_texts.append(merged_text)
            logger.debug(f"[Block Merge] '{stripped}' + '{next_text.strip()[:20]}...' → '{merged_text[:40]}...'")
            
            i += 2  # 두 블록을 모두 처리했으므로 +2
        else:
            # 병합 대상 아니면 그대로 추가
            merged_blocks.append(current_block)
            merged_texts.append(current_text)
            i += 1
    
    return merged_blocks, merged_texts


def _smart_join_lines(text: str) -> str:
    """
    문장 중간의 PDF 시각적 줄바꿈을 공백으로 결합.
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


def _merge_short_chunks(chunks: list, min_chars: int = 200, max_chars: int = 1200) -> list:
    """
    같은 섹션 내 min_chars 미만 청크를 인접 청크와 병합 (최대 max_chars까지).
    splitter.split_text() 직후 후처리로 사용.
    """
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


_COLOPHON_KEYWORDS = ["발행처:", "발행인:", "저작권", "©", "무단전재", "재배포를 금"]

def _is_colophon_chunk(text: str) -> bool:
    """발행처/저작권 페이지 청크 판별 — 2개 이상 키워드 포함 시 True."""
    return sum(1 for kw in _COLOPHON_KEYWORDS if kw in text) >= 2


def normalize_text(text: str) -> str:
    """
    RAG 품질을 위한 텍스트 정규화 (Phase 2.1: 구조 보존형)
    - Ÿ/특수문자 불릿 아티팩트 제거 (PDF 폰트 인코딩 오류)
    - 불렛 기호 표준화 (•, *, l -> -)
    - 체크박스/폼 필드 기호 정규화 (□ → [ ], ☑ → [v])
    - 중첩 표 아티팩트 제거 (⋮, ⋯ 수직 생략 기호)
    - 다중 공백 제거
    - 문장 중간 줄바꿈 → 공백 결합 (단락/불릿/표 경계 보존)
    """
    if not text:
        return ""

    # 0. PDF 불릿 폰트 아티팩트 정규화 (Ÿ, ÿ 등 → -)
    text = re.sub(r'[\u0178\u00ff\ufffd]', '-', text)

    # 0-1. 체크박스/폼 필드 기호 정규화 (Phase 2.15)
    # □ (U+25A1), ☐ (U+2610) → [ ], ☑ (U+2611), ✓ (U+2713) → [v]
    text = re.sub(r'[□☐\u25a1\u2610]', '[ ]', text)
    text = re.sub(r'[☑✓✔\u2611\u2713\u2714]', '[v]', text)

    # 0-2. 중첩 표 아티팩트 — 수직 생략 기호 제거 (Phase 2.15)
    # ⋮ (U+22EE), ⋯ (U+22EF), ⋰ (U+22F0), ⋱ (U+22F1)
    text = re.sub(r'[\u22ee\u22ef\u22f0\u22f1]', '', text)

    # 1. 불렛 기호 표준화 (•, *, l -> -)
    text = re.sub(r'^[ \t]*[•*l][ \t]+', '- ', text, flags=re.MULTILINE)

    # 2. 다중 공백 하나로 통합 (줄바꿈 제외)
    text = re.sub(r'[ \t]+', ' ', text)

    # 3. 문장 중간 줄바꿈 결합 (단락/불릿/표 경계는 보존)
    text = _smart_join_lines(text)

    return text.strip()


def _is_symbol_noise_chunk(text: str) -> bool:
    """
    기호/체크박스 위주의 의미없는 청크 감지 (Phase 2.15)

    중첩 표, 폼 필드, checkbox 그리드 등에서 발생하는
    `| [ ] | [ ] | [v] |` 형태의 저정보 청크를 필터링.

    의미 있는 문자(한글, 영문, 숫자) 비율이 15% 미만이면 noise로 판단.
    """
    if not text or len(text) < 10:
        return False
    # 파이프, 공백, 줄바꿈, 대시 제거 후 실제 내용 비율 계산
    base = re.sub(r'[\s|]', '', text)
    if not base:
        return True
    meaningful = len(re.findall(r'[가-힣a-zA-Z0-9]', base))
    return len(base) >= 15 and meaningful / len(base) < 0.15

def is_inside_table(block_bbox, table_bboxes: list) -> bool:
    """
    블록 중심점이 테이블 bbox 영역 내에 위치하는지 확인 (Phase 2.9)
    - 테이블로 이미 추출된 영역의 블록을 일반 텍스트 처리에서 제외하기 위함
    """
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
    PyMuPDF extract() 결과를 Markdown 테이블 텍스트로 변환 (Phase 2.9)
    - Phase 2.14: rowspan None 셀을 words 기반으로 보완 (번호·데이터명 복원)
      page + table_obj 전달 시 각 셀 bbox에 맞는 단어를 get_text("words")로 채움
    - Phase 2.14: rowspan forward-fill (words로도 빈 경우만 적용)
    - 구조 기반 제목 테이블 감지 → heading 텍스트로 반환 (Phase 2.9.1)
    """
    if not table_data:
        return ""

    # Phase 2.14: words 기반 None 셀 보완
    # PyMuPDF extract()가 rowspan/병합셀에서 None을 반환할 때
    # header_cells의 col 경계 + cells의 y 경계로 각 셀 bbox를 재구성해 words를 채움
    if page is not None and table_obj is not None:
        try:
            words = page.get_text("words")  # (x0,y0,x1,y1,word,block,line,wi)
            # col x 경계: header_cells
            col_xs = [(hc[0], hc[2]) for hc in table_obj.header.cells]
            # row y 경계: cells flat의 유니크 y값
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
            pass  # 보완 실패 시 원본 유지

    # None 셀 → 빈 문자열, 줄바꿈 → 공백 처리
    cleaned_rows = []
    for row in table_data:
        cleaned_row = []
        for cell in row:
            cleaned_row.append(re.sub(r'\s+', ' ', str(cell).strip()) if cell else "")
        # 모두 빈 셀인 행 스킵
        if any(c for c in cleaned_row):
            cleaned_rows.append(cleaned_row)

    if not cleaned_rows:
        return ""

    # Phase 2.9.1: 구조 기반 제목 테이블 감지 (언어/패턴 무관)
    total_cells = sum(len(row) for row in cleaned_rows)
    non_empty_cells = [c for row in cleaned_rows for c in row if c]
    empty_ratio = (total_cells - len(non_empty_cells)) / total_cells if total_cells else 0
    content_len = sum(len(c) for c in non_empty_cells)

    is_heading_table = (
        len(cleaned_rows) <= 2
        and len(non_empty_cells) <= 3
        and empty_ratio >= 0.3
        and content_len <= 60
    )
    if is_heading_table:
        return " ".join(non_empty_cells)

    # Phase 2.14: rowspan 병합셀 forward-fill (데이터 행만 적용)
    # PyMuPDF extract()는 병합 영역의 좌상단만 값을 넣고 나머지 행은 None → 빈 문자열
    # ※ prev_ff를 헤더가 아닌 빈 배열로 초기화: 헤더 텍스트가 데이터 행으로 오염되는 것 방지
    header_row = cleaned_rows[0]
    prev_ff = [""] * len(header_row)   # 헤더 값 아닌 빈 슬롯으로 시작
    ffilled = [header_row[:]]          # 헤더 행은 그대로 유지
    for row in cleaned_rows[1:]:       # 데이터 행만 forward-fill
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
        # 첫 행(헤더) 이후 구분선 삽입
        if i == 0:
            lines.append("| " + " | ".join(["---"] * len(row)) + " |")

    return "\n".join(lines)


def extract_text_by_page(file_content: bytes, filename: str) -> List[Dict[str, Any]]:
    """파일 확장자에 따라 텍스트 및 메타데이터 추출 (폰트/위치 정보 포함)"""
    ext = filename.split('.')[-1].lower()
    results = []

    try:
        if ext == 'pdf':
            doc = fitz.open(stream=file_content, filetype="pdf")
            for page_index, page in enumerate(doc):
                page_num = page_index + 1
                # "dict" 모드는 폰트 크기, 스타일, 좌표 정보를 상세히 제공함
                page_dict = page.get_text("dict")

                # 시각적으로 읽기 편한 순서로 정렬 (Y좌표 우선, 그 다음 X좌표)
                blocks = page_dict.get("blocks", [])
                blocks.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))

                page_height = page.rect.height

                # 🔴 Phase 2.9: 테이블 감지 — find_tables()로 테이블 영역 확보
                try:
                    page_tables = page.find_tables()
                    table_list = page_tables.tables if page_tables else []
                except Exception:
                    table_list = []

                table_bboxes = [t.bbox for t in table_list]

                # (y_pos, text, block_dict_or_None) 형태로 모든 항목 수집 후 Y좌표 정렬
                # → 테이블과 텍스트를 위치 순서 그대로 병합
                page_items = []  # (y_pos, text, block_dict | None)

                # 테이블 먼저 수집 (행-열 구조 보존 추출)
                for t in table_list:
                    ty0 = t.bbox[1]
                    ty1 = t.bbox[3]
                    # header/footer 영역 테이블 스킵
                    if ty0 < page_height * 0.08 or ty1 > page_height * 0.92:
                        continue
                    table_text = format_table_as_text(t.extract(), page=page, table_obj=t)
                    if table_text:
                        logger.debug(f"[Page {page_num}] Table extracted at y={ty0:.1f}")
                        page_items.append((ty0, table_text, {
                            "text": table_text,
                            "font_size": 9.0,
                            "bbox": list(t.bbox),
                            "page": page_num,
                            "is_table": True
                        }))

                # 일반 텍스트 블록 수집 (테이블 영역 내 블록 제외)
                for b in blocks:
                    if b["type"] == 0:  # 텍스트 블록
                        y0 = b["bbox"][1]
                        y1 = b["bbox"][3]

                        # Layer 1: bbox 기반 header/footer 제거 (Phase 2.6)
                        if y0 < page_height * 0.08:
                            continue
                        if y1 > page_height * 0.92:
                            continue

                        # Phase 2.9: 테이블 영역 내 블록 스킵 (extract_tables()가 이미 처리)
                        if table_bboxes and is_inside_table(b["bbox"], table_bboxes):
                            continue

                        block_lines = []
                        max_font_size = 0
                        for line in b["lines"]:
                            line_text = ""
                            prev_x = None
                            for span in line["spans"]:
                                # Phase 2.1: BBox 간격 인지하여 표 구분자 | 삽입
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
                                "page": page_num
                            }))

                # Y좌표 순으로 정렬 → 테이블과 텍스트가 문서 흐름에 맞게 병합됨
                page_items.sort(key=lambda x: x[0])

                blocks_data = [item[2] for item in page_items]
                page_text_parts = [item[1] for item in page_items]

                page_full_text = "\n\n".join(page_text_parts)
                # 앞 2페이지 중 TOC 페이지인 경우 블록 채 제외 (가장 강력한 TOC 제거)
                if page_num <= 2 and is_toc_chunk(page_full_text):
                    logger.info(f"[Page {page_num}] TOC page detected and skipped.")
                    continue

                if page_text_parts:
                    results.append({
                        "text": page_full_text,
                        "page": page_index + 1,
                        "blocks": blocks_data
                    })
            doc.close()
            return results

        elif ext in ['doc', 'docx']:
            doc = Document(io.BytesIO(file_content))
            WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

            def _cell_text(cell_elm) -> str:
                """셀 내 모든 w:t 텍스트 수집 (중첩 표 포함)"""
                return normalize_text(
                    "".join(node.text or "" for node in cell_elm.iter() if node.tag == f"{{{WNS}}}t")
                )

            def _extract_table(tbl_elm) -> str:
                """표 element → '| c1 | c2 |' 형식 문자열 (최상위 행만)"""
                rows_text = []
                for tr in tbl_elm.findall(f"{{{WNS}}}tr"):
                    cells = []
                    seen = set()
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
                    # 스타일로 font_size 추정
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
                        # 첫 번째 w:sz 값 (half-points → pt)
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
            return [{"text": full_text, "page": 1, "blocks": blocks}]

        elif ext in ['txt', 'md']:
            full_text = normalize_text(file_content.decode('utf-8'))
            return [{"text": full_text, "page": 1, "blocks": []}]
        
        else:
            raise ValueError(f"지원하지 않는 파일 형식입니다: {ext}")
    except Exception as e:
        logger.error(f"Text extraction failed for {filename}: {e}")
        raise ValueError(f"텍스트 추출 중 오류가 발생했습니다: {str(e)}")

async def process_and_ingest(filename: str, pages: List[Dict[str, Any]], metadata: Dict[str, Any]):
    """배경 작업: Phase 2.4 운영급 구조 개편 (Section-First Chunking)"""
    try:
        if not gemini_client:
            logger.error("Gemini client not initialized.")
            return

        doc_id = str(uuid4())
        ingested_at = datetime.utcnow().isoformat()

        # 🔴 Layer 2: 반복 header/footer 탐지 (Phase 2.5)
        repeated_headers = detect_repeated_headers(pages)
        if repeated_headers:
            logger.info(f"[{filename}] Repeated headers detected ({len(repeated_headers)}): {list(repeated_headers)[:5]}")

        # 1. 문서 전체 블록 취합
        all_blocks = []
        for page_data in pages:
            all_blocks.extend(page_data.get("blocks", []))
        
        if not all_blocks:
            logger.warning(f"[{filename}] No blocks extracted from document.")
            return

        # 🔴 Phase 2.8: Block Merge (재설계) — 전체 문서 단위 병합 적용
        # 이전에는 page별로만 merge했으나, 이제 all_blocks 단위로 통합 병합
        all_blocks_text = [b.get("text", "") for b in all_blocks]
        merged_blocks_data, merged_blocks_text = merge_adjacent_short_blocks(all_blocks, all_blocks_text)
        logger.info(f"[{filename}] Block merge result: {len(all_blocks)} → {len(merged_blocks_data)} blocks")
        
        # merged blocks를 build_sections에 전달 (heading detection이 merge 결과 기반으로 작동)
        all_blocks = merged_blocks_data

        # 2. 섹션 계층 구조 구축 (Production Section Builder)
        sections = build_sections(all_blocks)
        logger.info(f"[{filename}] build_sections result: {len(sections)} sections")
        if not sections:
            logger.warning(f"[{filename}] No sections built — check build_sections logic for this PDF structure.")
            return
        # 섹션별 텍스트 길이 샘플 (최대 5개)
        for i, s in enumerate(sections[:5]):
            sec_text = "\n".join(b.get("text", "") for b in s.get("blocks", []))
            logger.info(f"[{filename}] Section[{i}] heading={s.get('heading','')!r:.30} blocks={len(s.get('blocks',[]))} text_len={len(sec_text)}")

        # 3. 섹션 기반 청킹 및 데이터 매핑
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1200, # 운영급 최적 사이즈
            chunk_overlap=200,
            separators=["\n\n", "\n- ", "\n"]
        )
        
        section_stack = []
        all_chunks_to_embed = []
        seen_hashes = set()
        _filter_counts = {"toc": 0, "colophon": 0, "symbol": 0, "too_short": 0, "duplicate": 0}

        for sec in sections:
            heading = sec["heading"]
            level = sec["level"]

            # Phase 2.10: heading 정규화 — \n 제거 (merge 불완전성 대비)
            normalized_heading = heading.replace('\n', ' ').replace('  ', ' ').strip()

            # 섹션 경로 업데이트 (Stack 관리)
            if normalized_heading != "Root":
                section_stack = section_stack[:level-1]
                section_stack.append(normalized_heading)

            section_path = " > ".join(section_stack) if section_stack else "Document"

            # 블록별 시작 offset과 페이지 번호를 기록 (chunk 페이지 역추적용)
            block_page_offsets = []  # [(char_offset, page_num), ...]
            section_text_parts = []
            cur_offset = 0
            for b in sec["blocks"]:
                b_text = b.get("text", "")
                block_page_offsets.append((cur_offset, b.get("page", sec["page"])))
                section_text_parts.append(b_text)
                cur_offset += len(b_text) + 1  # +1 for "\n"
            section_text = "\n".join(section_text_parts)

            # Phase 2.11: 섹션 레벨 TOC 필터 제거
            # 문제: "1 제2권 AI 데이터 구축 가이드 구성" 같은 정상 섹션 헤딩이 TOC로 오판되어 전체 섹션 손실
            # 해결: Section은 보통 정상 콘텐츠이므로 섹션 레벨 필터 제거
            #      - Page 레벨 필터 (초반 TOC 페이지): 유지
            #      - Chunk 레벨 필터 (개별 청크 TOC): 유지
            # 이전 코드:
            # if is_toc_chunk(section_text):
            #     logger.info(f"[{filename}] TOC section skipped: '{normalized_heading}'")
            #     continue

            # 의미 단위 분할 (Semantic Chunking)
            raw_chunks = splitter.split_text(section_text)

            # P2-2: 짧은 청크 병합 (200자 미만 → 인접 청크와 합침, 최대 1200자)
            raw_chunks = _merge_short_chunks(raw_chunks, min_chars=200, max_chars=1200)

            for chunk_text in raw_chunks:
                # 표 중간 split 복원: [표] 마커 없이 파이프로 시작하는 표 연속 청크에 마커 추가
                stripped = chunk_text.lstrip()
                if stripped.startswith("|") and "---" in stripped and not stripped.startswith("[표]"):
                    chunk_text = "[표]\n" + stripped

                # 첩크 레벨 TOC 필터 (Phase 2.13: · 밀도 기반으로 교정 후 재활성화)
                if is_toc_chunk(chunk_text):
                    logger.info(f"[{filename}] TOC chunk filtered (p{sec['page']}): {chunk_text[:50]!r}")
                    _filter_counts["toc"] += 1
                    continue

                # P2-3: 발행처/저작권 청크 필터 (인제스션 레벨에서 제거)
                if _is_colophon_chunk(chunk_text):
                    logger.info(f"[{filename}] Colophon chunk filtered (p{sec['page']}): {chunk_text[:50]!r}")
                    _filter_counts["colophon"] += 1
                    continue

                # Phase 2.15: 기호/체크박스 노이즈 청크 필터 (중첩 표, 폼 필드 등)
                if _is_symbol_noise_chunk(chunk_text):
                    logger.info(f"[{filename}] Symbol noise chunk filtered (p{sec['page']}): {chunk_text[:60]!r}")
                    _filter_counts["symbol"] += 1
                    continue

                # 🔴 Layer 3: footer/header bleed-through 노이즈 제거 (Phase 2.5)
                chunk_text = remove_footer_noise(chunk_text, repeated_headers)

                # 🔴 Phase 2.7: section heading 중복 제거 (embedding 입력 정화)
                chunk_text = strip_redundant_headings(chunk_text, heading)

                # 품질 필터 (노이즈 제거 후 기준 적용)
                if len(chunk_text.strip()) < 50:
                    _filter_counts["too_short"] += 1
                    continue

                # 중복 제거 (정규화 해시)
                norm_text = normalize_for_hash(chunk_text)
                content_hash = hashlib.sha1(norm_text.encode('utf-8')).hexdigest()
                if content_hash in seen_hashes:
                    _filter_counts["duplicate"] += 1
                    continue
                seen_hashes.add(content_hash)
                
                # 컨텍스트 프리픽스 주입 (Retrieval 최적화)
                context_prefix = build_context_prefix(filename, section_path, sec["page"])
                enriched_text = context_prefix + chunk_text
                
                # 메타데이터 준비
                keywords = extract_keywords(chunk_text)
                chunk_type = detect_chunk_type(chunk_text).lower()

                # Phase 2.10: section_title 정규화 — \n 제거 (merge 불완전성 대비)
                # merge가 미처 작동하지 않은 경우 "1\n작성 배경" 같은 heading이 들어올 수 있으므로
                # 이를 "1 작성 배경"으로 정규화
                normalized_section_title = heading.replace('\n', ' ').replace('  ', ' ').strip()

                all_chunks_to_embed.append({
                    "text": enriched_text,
                    "raw_text": chunk_text,
                    "page": _resolve_chunk_page(chunk_text, section_text, block_page_offsets, sec["page"]),
                    "hash": content_hash,
                    "section_title": normalized_section_title,
                    "section_path": section_path,
                    "section_level": level,
                    "chunk_type": chunk_type,
                    "keywords": keywords
                })

        logger.info(f"[{filename}] Section-First processing complete: {len(all_chunks_to_embed)} chunks. Filtered — {_filter_counts}")

        # 4. 배치 임베딩 및 저장 (Batch Size=64)
        batch_size = 64
        for i in range(0, len(all_chunks_to_embed), batch_size):
            batch = all_chunks_to_embed[i : i + batch_size]
            batch_texts = [item["text"] for item in batch]
            
            res = await gemini_client.aio.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=batch_texts,
                config=google_genai.types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=1536
                )
            )
            
            for idx, emb_data in enumerate(res.embeddings):
                c = batch[idx]
                embedding_np = np.array(emb_data.values)
                norm = np.linalg.norm(embedding_np)
                normalized_embedding = (embedding_np / norm).tolist() if norm > 0 else emb_data.values
                
                chunk_metadata = {
                    **metadata,
                    "document_id": doc_id,
                    "filename": filename,
                    "content_hash": c["hash"],
                    "section_title": c["section_title"],
                    "section_path": c["section_path"],
                    "section_level": c["section_level"],
                    "chunk_type": c["chunk_type"],
                    "keywords": c["keywords"],
                    "page": c["page"],
                    "char_length": len(c["raw_text"]),
                    "chunk_index": i + idx,
                    "total_chunks": len(all_chunks_to_embed),
                    "source": filename.split('.')[-1].lower() if '.' in filename else 'unknown',
                    "ingested_at": ingested_at,
                    "embedding_model": "gemini-embedding-2-preview"
                }
                
                # 불필요한 구형 메타데이터 필드 정리 (null 유발 방지)
                for old_key in ["hierarchy_l1", "hierarchy_l2", "hierarchy_l3"]:
                    if old_key in chunk_metadata:
                        del chunk_metadata[old_key]
                
                await save_doc_chunk(c["raw_text"], normalized_embedding, chunk_metadata)
            
            logger.info(f"   - Batch {i//batch_size + 1} finalized ({len(batch)} chunks).")
            
        if len(all_chunks_to_embed) == 0:
            logger.error(
                f"❌ [{filename}] 0 chunks produced after full pipeline. "
                f"Filtered — {_filter_counts}. "
                "Check PDF text quality or filter thresholds."
            )
            return

        logger.info(f"✅ Phase 2.4 Upgrade Complete: {filename} ({len(all_chunks_to_embed)} chunks)")
        logger.info(f"✅ Enhanced Ingestion Complete: {filename} ({len(all_chunks_to_embed)} chunks)")
        
    except Exception as e:
        logger.error(f"❌ Ingestion Pipeline Failure {filename}: {e}", exc_info=True)

@router.post("/upload", response_model=IngestionResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    hierarchy_l1: Optional[str] = Form(None),
    hierarchy_l2: Optional[str] = Form(None),
    hierarchy_l3: Optional[str] = Form(None)
):
    """문서 업로드 및 벡터화 인제스션 시작"""
    if not is_supabase_available():
        raise HTTPException(status_code=500, detail="Supabase 설정이 구성되지 않았습니다.")
    
    try:
        # 1. 파일 내용 읽기
        content_bytes = await file.read()
        
        # 2. 텍스트 추출 (페이지 기반)
        pages = extract_text_by_page(content_bytes, file.filename)
        if not pages:
            raise HTTPException(status_code=400, detail="텍스트를 추출할 수 없거나 비어 있는 문서입니다.")

        # 텍스트 밀도 사전 검사 — PDF: block 기반, DOCX/TXT: page-level text 기반
        ext_lower = file.filename.split('.')[-1].lower()
        if ext_lower == 'pdf':
            total_text = "".join(
                b.get("text", "") for p in pages for b in p.get("blocks", [])
            )
            total_blocks = sum(len(p.get("blocks", [])) for p in pages)
            avg_chars_per_block = len(total_text) / max(total_blocks, 1)
            if len(total_text) < 300 or avg_chars_per_block < 5:
                logger.warning(
                    f"[{file.filename}] Insufficient text: total={len(total_text)} chars, "
                    f"blocks={total_blocks}, avg={avg_chars_per_block:.1f} chars/block. "
                    "Likely image-based or symbol-font PDF."
                )
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "PDF에서 텍스트를 추출할 수 없습니다. "
                        "이미지 기반 PDF이거나 커스텀 심볼 폰트를 사용하는 문서입니다. "
                        "텍스트 레이어가 포함된 PDF를 업로드해 주세요."
                    )
                )
        else:
            # DOCX / TXT / MD — page-level text로 검사
            total_text = "".join(p.get("text", "") for p in pages)
            if len(total_text) < 100:
                raise HTTPException(
                    status_code=400,
                    detail="문서에서 텍스트를 추출할 수 없습니다. 내용이 비어 있거나 지원하지 않는 형식입니다."
                )

        # 3. 비동기 백그라운드 작업 예약
        metadata = {
            "hierarchy_l1": hierarchy_l1,
            "hierarchy_l2": hierarchy_l2,
            "hierarchy_l3": hierarchy_l3,
            "filename": file.filename
        }
        
        background_tasks.add_task(process_and_ingest, file.filename, pages, metadata)
        
        return IngestionResponse(
            success=True,
            message="문서 업로드가 완료되었습니다. 백그라운드에서 벡터화 작업이 진행됩니다.",
            file_name=file.filename
        )
        
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/analyze-tagging-samples", response_model=TaggingPreviewResponse)
async def analyze_tagging_samples(request: GranularTaggingRequest):
    """
    검증용 샘플 분석: DB 업데이트 없이 3~5개 청크에 대해 AI가 어떻게 태깅할지 미리 보여줌
    """
    logger.info(f"🧪 [Preview] Analyzing tagging samples for: {request.filename}")
    if not gemini_client:
        raise HTTPException(status_code=500, detail="Gemini client not initialized")

    # 1. 문서 청크 가져오기 (중간 지점에서 3-5개 샘플링)
    # get_document_chunks는 Supabase 헬퍼 함수
    all_chunks = await get_document_chunks(request.filename, limit=100)
    if not all_chunks:
        # 이 부분이 detail="No chunks found"를 반환하지만, 전체 404면 FASTAPI가 "Not Found"를 뱉음
        raise HTTPException(status_code=404, detail="No chunks found")
    
    sample_indices = [0, len(all_chunks)//2, min(len(all_chunks)-1, 20)]
    sample_indices = sorted(list(set(sample_indices)))
    samples = [all_chunks[i] for i in sample_indices if i < len(all_chunks)]
    
    chunks_data = [{"id": s["id"], "content": s["content"][:800]} for s in samples]
    
    prompt = f"""
    Analyze these text chunks and assign the most appropriate [L1, L2, L3] hierarchy for each.
    This is for PREVIEW only.
    
    ### Master L1 List (Choose ONE for each chunk):
    {request.selected_l1_list}
    
    ### Requirements:
    - Korean term, under 15 characters.
    - Result MUST be valid JSON array.
    
    ### Input Chunks:
    {json.dumps(chunks_data, ensure_ascii=False)}
    
    ### JSON Structure:
    [
      {{
        "id": "chunk_uuid",
        "hierarchy": {{ "l1": "...", "l2": "...", "l3": "..." }}
      }},
      ...
    ]
    """
    
    try:
        res = await gemini_client.aio.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=google_genai.types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        tagging_results = json.loads(res.text)

        final_samples = []
        for item in tagging_results:
            orig = next((s for s in samples if s["id"] == item["id"]), None)
            if orig:
                final_samples.append(TaggingSample(
                    id=item["id"],
                    content_preview=orig["content"][:150] + "...",
                    hierarchy=item["hierarchy"]
                ))
        return TaggingPreviewResponse(samples=final_samples)
    except Exception as e:
        logger.error(f"❌ Sample analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analyze-hierarchy", response_model=HierarchyAnalysisResponse)
async def analyze_hierarchy(request: HierarchyAnalysisRequest):
    """
    1단계: 마스터 스키마 도출 (Global Analysis)
    문서의 주요 샘플들을 분석하여 문서 전체를 관통하는 L1 후보 그룹 도출
    """
    logger.info(f"🔍 [Step 1] Master Schema Discovery for: {request.filename}")
    if not gemini_client:
        raise HTTPException(status_code=500, detail="Gemini client not initialized")
    
    # 1. 문서 샘플 청크 가져오기 (첫 15개 정도 여유있게)
    chunks = await get_document_chunks(request.filename, limit=15)
    if not chunks:
        raise HTTPException(status_code=404, detail=f"No chunks found for document: {request.filename}")
    
    concatenated_text = "\n\n".join([c["content"] for c in chunks])
    
    prompt = f"""
<role>
You are an expert document classifier. Discover the Master Schema (L1 categories) for the provided document.
</role>

<constraints>
- Identify exactly 3~5 distinct L1 domain categories that cover the full document.
- L1 names must be in Korean (한국어), under 15 characters each.
- L1 must represent content themes or domains — NOT section titles or headings.
- Provide one concrete L1/L2/L3 example from the document.
</constraints>

<context>
{concatenated_text[:15000]}
</context>

<task>
Analyze the document above and return a JSON object with this exact structure:
{{
  "domain_analysis": "한 문장으로 문서 전체 성격 요약",
  "l1_candidates": ["카테고리1", "카테고리2", "카테고리3"],
  "suggested_hierarchy": {{
    "l1": "L1명",
    "l2": "L2명",
    "l3": "L3명"
  }},
  "validation": "이 분류 방식이 적합한 이유 한 문장"
}}
</task>
"""
    
    try:
        response = await gemini_client.aio.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=google_genai.types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )

        analysis_res = json.loads(response.text)
        logger.info(f"✅ Master Schema discovered with {len(analysis_res.get('l1_candidates', []))} candidates")
        return HierarchyAnalysisResponse(**analysis_res)
        
    except Exception as e:
        logger.error(f"❌ Master Schema Discovery failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/analyze-l2-l3", response_model=L2L3AnalysisResponse)
async def analyze_l2_l3(request: L2L3AnalysisRequest):
    """
    2단계: L2/L3 Master 생성
    L1 master list + 전체 청크 샘플 → L1별 L2 목록 + L2별 L3 후보 동시 생성 (1회 LLM 호출)
    제약: L1당 L2 2~5개, L2당 L3 2~4개
    """
    logger.info(f"🗂️ [Step 2] L2/L3 Master Discovery for: {request.filename}")
    if not gemini_client:
        raise HTTPException(status_code=500, detail="Gemini client not initialized")

    chunks = await get_document_chunks(request.filename, limit=30)
    if not chunks:
        raise HTTPException(status_code=404, detail=f"No chunks found for document: {request.filename}")

    sample_text = "\n\n---\n\n".join([c["content"][:600] for c in chunks[:20]])

    prompt = f"""
<role>
You are an expert document classifier building a strict hierarchical taxonomy.
Generate L2 sub-categories and L3 leaf labels for the given L1 master list.
</role>

<constraints>
- For each L1, create 2~5 L2 sub-categories covering distinct content themes.
- For each L2, create 2~4 specific L3 labels describing concrete content within that L2.
- L2 must NOT repeat section titles — classify by content theme, function, or topic.
- All names in Korean (한국어), under 15 characters each.
- Cover the full range of the document using the provided samples.
</constraints>

<l1_master>
{json.dumps(request.selected_l1_list, ensure_ascii=False)}
</l1_master>

<context>
{sample_text[:12000]}
</context>

<task>
Based on the context above, generate the L2/L3 taxonomy and return a JSON object with this exact structure:
{{
  "L1명": {{
    "L2명A": ["L3명1", "L3명2", "L3명3"],
    "L2명B": ["L3명1", "L3명2"]
  }}
}}
</task>
"""

    try:
        res = await gemini_client.aio.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=google_genai.types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        l2_l3_master = json.loads(res.text)
        total_l2 = sum(len(v) for v in l2_l3_master.values())
        total_l3 = sum(len(lst) for d in l2_l3_master.values() for lst in d.values())
        logger.info(f"✅ L2/L3 Master generated: {len(l2_l3_master)} L1, {total_l2} L2, {total_l3} L3")
        return L2L3AnalysisResponse(l2_l3_master=l2_l3_master)
    except Exception as e:
        logger.error(f"❌ L2/L3 Master Discovery failed: {e}")
        raise HTTPException(status_code=500, detail=f"L2/L3 analysis failed: {str(e)}")


@router.get("/hierarchy-list")
async def get_hierarchy_list_endpoint(filename: str = None):
    """
    doc_chunks에 저장된 hierarchy_l1, hierarchy_l2 고유 목록 반환
    프론트엔드 QA 생성 UI의 계층 선택 드롭다운에서 사용
    filename 지정 시 해당 문서 청크만 대상으로 조회 (GET ?filename=xxx)
    """
    if not is_supabase_available():
        return {"success": False, "l1_list": [], "l2_by_l1": {}, "message": "Supabase not available"}

    result = await get_hierarchy_list(filename=filename)
    return {"success": True, **result}


@router.get("/test")
async def test_ingestion_route():
    return {"message": "Ingestion router is working"}


@router.post("/apply-granular-tagging")
async def apply_granular_tagging(request: GranularTaggingRequest):
    """
    2&3단계: 개별 청크별 세밀한 매핑 실행 (동기 처리 — 완료 후 반환)
    """
    logger.info(f"🚀 [Step 2&3] Starting Granular Tagging for: {request.filename}")
    
    # 백그라운드 태깅 프로세스 정의
    async def run_tagging():
        from config.supabase_client import update_chunk_metadata

        # 1. 모든 청크 가져오기
        all_chunks = await get_document_chunks(request.filename, limit=2000)
        if not all_chunks:
            return

        logger.info(f"📊 Processing {len(all_chunks)} chunks for {request.filename}")

        batch_size = 5
        batches = [all_chunks[i:i+batch_size] for i in range(0, len(all_chunks), batch_size)]
        semaphore = asyncio.Semaphore(5)  # 동시 최대 5배치 (Gemini 3.1 Flash: 1,000 RPM)
        completed = 0

        def _build_prompt(chunks_data: list) -> str:
            if request.l2_l3_master:
                return f"""
<role>
You are a strict document taxonomy classifier.
You MUST select L1, L2, L3 values exclusively from the provided master_hierarchy.
Do NOT generate, invent, or paraphrase any new values under any circumstances.
</role>

<constraints>
- L1: select ONE value from the top-level keys of master_hierarchy
- L2: select ONE value from the L2 keys under the selected L1
- L3: select ONE value from the L3 list under the selected L2 (choose the closest match if none fits perfectly)
- All selected values must exist verbatim in master_hierarchy
</constraints>

<master_hierarchy>
{json.dumps(request.l2_l3_master, ensure_ascii=False, indent=2)}
</master_hierarchy>

<chunks>
{json.dumps(chunks_data, ensure_ascii=False)}
</chunks>

<task>
For each chunk, select the best-fitting L1/L2/L3 from master_hierarchy.
Return ONLY a JSON array with this exact structure — no explanation:
[
  {{
    "idx": 0,
    "hierarchy": {{ "l1": "...", "l2": "...", "l3": "..." }}
  }}
]
</task>
"""
            else:
                return f"""
<role>
You are a document taxonomy classifier.
Assign the most appropriate L1/L2/L3 hierarchy to each text chunk.
</role>

<constraints>
- L1: select ONE from the l1_master list
- L2: must represent a content theme or function — do NOT repeat section titles
- L3: specific label describing the chunk's concrete content
- L2 and L3: Korean (한국어), under 15 characters each
</constraints>

<l1_master>
{json.dumps(request.selected_l1_list, ensure_ascii=False)}
</l1_master>

<chunks>
{json.dumps(chunks_data, ensure_ascii=False)}
</chunks>

<task>
Return ONLY a JSON array with this exact structure — no explanation:
[
  {{
    "idx": 0,
    "hierarchy": {{ "l1": "...", "l2": "...", "l3": "..." }}
  }}
]
</task>
"""

        async def process_batch(batch_idx: int, batch: list):
            nonlocal completed
            async with semaphore:
                # Use sequential indices instead of UUIDs (LLMs may corrupt long UUIDs)
                chunks_data = [{"idx": i, "content": c["content"][:1000]} for i, c in enumerate(batch)]
                try:
                    # aio (비동기) 클라이언트 사용 — 이벤트 루프 블로킹 없음
                    res = await gemini_client.aio.models.generate_content(
                        model="gemini-3-flash-preview",
                        contents=_build_prompt(chunks_data),
                        config=google_genai.types.GenerateContentConfig(
                            response_mime_type="application/json"
                        )
                    )
                    tagging_results = json.loads(res.text)

                    # 인덱스 기반 매핑 (UUID 대신 idx 사용 — LLM이 UUID를 변형할 수 있음)
                    update_tasks = []
                    matched = 0
                    for item in tagging_results:
                        idx = item.get("idx")
                        h = item.get("hierarchy", {})
                        if idx is None or not isinstance(idx, int) or idx >= len(batch):
                            logger.warning(f"[Tagging] Invalid idx={idx} in batch {batch_idx + 1}, skipping")
                            continue
                        target = batch[idx]
                        chunk_id = target["id"]
                        meta = {**target.get("metadata", {}),
                                "hierarchy_l1": h.get("l1"),
                                "hierarchy_l2": h.get("l2"),
                                "hierarchy_l3": h.get("l3")}
                        update_tasks.append(update_chunk_metadata(chunk_id, meta))
                        matched += 1

                    logger.info(f"[Tagging] Batch {batch_idx + 1}: {matched}/{len(batch)} chunks matched, queuing updates")
                    if update_tasks:
                        await asyncio.gather(*update_tasks)

                    completed += 1
                    logger.info(f"✅ Logged/Tagged batch {batch_idx + 1}/{len(batches)} ({matched} updated)")
                except Exception as e:
                    logger.error(f"❌ Batch tagging error at batch {batch_idx + 1}: {e}")

        # 2. 전체 배치 병렬 실행 (Semaphore로 동시성 제한)
        await asyncio.gather(*[process_batch(i, b) for i, b in enumerate(batches)])
        logger.info(f"🏁 Granular Tagging finished for {request.filename} ({completed}/{len(batches)} batches OK)")

    await run_tagging()
    return {"success": True, "message": f"Granular tagging completed for {len(request.selected_l1_list)} L1 categories."}


@router.post("/update-hierarchy")
async def update_hierarchy(filename: str = Form(...), l1: str = Form(...), l2: str = Form(...), l3: str = Form(...)):
    """
    AI로 제안된 또는 사용자가 수정한 계층 정보를 해당 문서의 모든 청크에 반영
    """
    logger.info(f"💾 Updating hierarchy for {filename}: L1={l1}, L2={l2}, L3={l3}")
    success = await update_document_hierarchy(filename, l1, l2, l3)
    if success:
        return {"success": True, "message": f"Updated hierarchy for {filename}"}
    else:
        raise HTTPException(status_code=500, detail="Failed to update hierarchy in database")


def setup_ingestion_routes(app):
    app.include_router(router)
