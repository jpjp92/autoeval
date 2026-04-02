"""
ingestion/prompts.py

LLM 호출에 사용하는 프롬프트 빌더 함수 모음.
모든 함수는 순수 함수(입력 → 문자열)로, 외부 상태에 의존하지 않는다.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional


def build_hierarchy_prompt(concatenated_text: str, h2_guide: str) -> str:
    """H1/H2/H3 taxonomy + domain_profile 생성 프롬프트."""
    return f"""
<role>
You are an expert document classifier and domain analyst.
Build a complete hierarchical taxonomy (H1/H2/H3) AND extract a domain profile for the provided document.
</role>

<constraints>
- H1 COUNT RULE (STRICTLY ENFORCED): You MUST output between 3 and 5 H1 keys — no fewer than 3, no more than 5.
  If you identify more than 5 themes, MERGE the most similar or overlapping ones until you have at most 5.
  Think of H1 as broad domain pillars, not chapter titles.
- For each H1, create {h2_guide} H2 sub-categories covering distinct content themes.
- For each H2, create 2~4 specific H3 leaf labels.
- All taxonomy names in Korean (한국어), under 15 characters each.
- H1 must represent LEARNABLE content themes — NOT administrative metadata.
- H1 must NOT be: dates, ordinance numbers, contact info, department names, page headers.
- Bad H1 examples: "시행일 관리", "담당부서", "고시번호"
- Good H1 examples: "데이터 연계 기준", "정보시스템 운영", "보안 정책"
- TEXT QUALITY RULE: The context may contain PDF extraction artifacts such as digits or ASCII
  letters embedded inside Korean words (e.g. "상호작2용", "상호작acts용", "인터페Ÿ스").
  You MUST infer and write the correct clean Korean word — never copy corrupted text into
  any H1/H2/H3 name. All taxonomy labels must consist of natural Korean only.
</constraints>

<context>
{concatenated_text[:20000]}
</context>

<task>
Return a JSON object with this exact structure (all string values in Korean):
{{
  "domain_analysis": "한 문장으로 문서 전체 성격 요약",
  "domain_profile": {{
    "domain": "문서 분야/유형 (예: AI 데이터 구축 가이드라인)",
    "domain_short": "짧은 도메인명, 10자 이내",
    "target_audience": "주요 독자층 (예: 데이터 구축 작업자)",
    "key_terms": ["전문용어1", "전문용어2", "전문용어3", "전문용어4", "전문용어5"],
    "tone": "문서 문체 (예: 기술 문서 격식체)"
  }},
  "h2_h3_master": {{
    "H1명A": {{
      "H2명1": ["H3명1", "H3명2"],
      "H2명2": ["H3명1", "H3명2"]
    }},
    "H1명B": {{
      "H2명1": ["H3명1", "H3명2"]
    }}
  }}
}}
</task>
"""


def build_tagging_prompt(
    chunks_data: List[Dict[str, Any]],
    h2_h3_master: Optional[Dict[str, Dict[str, List[str]]]] = None,
    selected_h1_list: Optional[List[str]] = None,
) -> str:
    """청크 태깅 프롬프트.

    h2_h3_master가 있으면 master_hierarchy 기반 엄격 분류,
    없으면 h1_master 기반 H1만 지정 후 H2/H3 자유 생성.
    """
    chunks_json = json.dumps(chunks_data, ensure_ascii=False)
    task_suffix = (
        '[{ "idx": 0, "hierarchy": { "h1": "...", "h2": "...", "h3": "..." } }]'
    )

    if h2_h3_master:
        master_json = json.dumps(h2_h3_master, ensure_ascii=False, indent=2)
        return f"""
<role>
You are a strict document taxonomy classifier.
Select H1, H2, H3 values EXCLUSIVELY from master_hierarchy. Do NOT generate new values.
</role>

<constraints>
- Classify each chunk INDEPENDENTLY. Do not compare chunks within this batch.
- H1: select ONE from top-level keys of master_hierarchy
- H2: select ONE from H2 keys under selected H1
- H3: select ONE from H3 list under selected H2
- EXCEPTION: If a chunk contains ONLY administrative metadata (dates, ordinance numbers,
  phone numbers, department names, page headers) with NO learnable content,
  set h1="__admin__", h2="__admin__", h3="__admin__".
  Use __admin__ sparingly — only when the chunk has absolutely no subject matter content.
</constraints>

<master_hierarchy>
{master_json}
</master_hierarchy>

<chunks>
{chunks_json}
</chunks>

<task>
Return ONLY a JSON array — no explanation:
{task_suffix}
</task>
"""
    else:
        h1_json = json.dumps(selected_h1_list or [], ensure_ascii=False)
        return f"""
<role>You are a document taxonomy classifier.</role>

<constraints>
- Classify each chunk INDEPENDENTLY. Do not compare chunks within this batch.
- H1: select ONE from h1_master
- H2/H3: Korean, under 15 characters each
- EXCEPTION: If a chunk contains ONLY administrative metadata (dates, ordinance numbers,
  phone numbers, department names) with NO learnable content,
  set h1="__admin__", h2="__admin__", h3="__admin__".
</constraints>

<h1_master>
{h1_json}
</h1_master>

<chunks>
{chunks_json}
</chunks>

<task>
Return ONLY a JSON array — no explanation:
{task_suffix}
</task>
"""
