#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QA 데이터 품질 평가 시스템 (2-Layer with GPT-5.1)

📋 구조:
  - Layer 1️⃣: 데이터 구조 검증 (자동/통계)
      1-A. 구문 정확성 (Syntax Validation) - 필드/타입/길이 검증 → PASS/FAIL
      1-B. 데이터셋 통계 (Dataset Statistics) - 커버리지/유형분포/중복률/편중도/데이터충실도
  - Layer 2️⃣: LLM 품질 평가 (GPT-5.1 CoT 기반)
      사실성(Factuality) / 완결성(Completeness) / 근거성(Groundedness)

📊 사용 방법:
  uv run qa_quality_evaluator.py --input FILE
  uv run qa_quality_evaluator.py --input FILE --limit 10

📁 출력:
  - Console: 평가 결과 테이블 및 통계
  - JSON: validated_output/qa_quality_results_*.json
"""

import json
import re
import os
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime
from collections import Counter
import argparse
from difflib import SequenceMatcher
from dotenv import load_dotenv

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box

try:
    from openai import OpenAI
except ImportError:
    print("오류: OpenAI 라이브러리 필요")
    print("설치: uv add openai")
    exit(1)

console = Console()
load_dotenv()


# ============================================================================
# 모델 설정 (main.py와 동기화)
# ============================================================================

MODEL_CONFIG = {
    "gpt-5.1": {
        "provider": "openai",
        "model_id": "gpt-5.1-2025-11-13",
        "name": "GPT-5.1",
    },
    "gpt-4o": {
        "provider": "openai",
        "model_id": "gpt-4o",
        "name": "GPT-4o",
    },
}


def get_model_id(model: str) -> str:
    """모델 약칭에서 실제 API model_id 가져오기"""
    if model in MODEL_CONFIG:
        return MODEL_CONFIG[model]["model_id"]
    # 직접 입력된 model_id라면 그대로 반환
    return model


# ============================================================================
# 마크다운 정제 함수
# ============================================================================

def clean_markdown(text: str) -> str:
    """컨텍스트에서 마크다운 정크 제거 (안전한 버전)"""
    if not text or not isinstance(text, str):
        return text
    
    try:
        # 1. 간단한 패턴: *닫기*, *열기* 등 UI 태그 제거
        text = re.sub(r'\*[닫열변삭기시구기터이][^*]*\*', '', text)
        
        # 2. 테이블 마크다운 라인 제거
        text = re.sub(r'^\|[-\s|]+\|$', '', text, flags=re.MULTILINE)
        
        # 3. 마크다운 링크 단순화: [text](url) -> text
        text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
        
        # 4. HTML 엔티티 정리
        text = text.replace('\\\\n', '\n').replace('\\n', '\n')
        
        # 5. 줄 앞뒤 공백 정리
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        text = '\n'.join(lines)
        
        # 6. 빈 줄 정리 (3개 이상 연속 -> 1개)
        while '\n\n\n' in text:
            text = text.replace('\n\n\n', '\n\n')
        
        return text
    except Exception as e:
        console.print(f"[yellow]⚠️ 정제 오류: {e}[/yellow]")
        return text  # 오류 시 원본 반환


# ============================================================================

class SyntaxValidator:
    """QA 데이터 구문 정확성 검증 (Layer 1)"""
    
    CONFIG = {
        "q_length": (5, 500),
        "a_length": (10, 2000),
        "context_length": (50, 50000),
        "required_fields": ["q", "a", "context"],
    }
    
    @staticmethod
    def validate_qa(qa_item: Dict) -> Tuple[bool, List[str]]:
        """QA 항목 구문 검증"""
        errors = []
        
        if not isinstance(qa_item, dict):
            errors.append("QA is not a dictionary")
            return False, errors
        
        for field in SyntaxValidator.CONFIG["required_fields"]:
            if field not in qa_item:
                errors.append(f"Missing required field: {field}")
            elif not isinstance(qa_item.get(field), str):
                errors.append(f"Field '{field}' is not a string")
        
        if "q" in qa_item and isinstance(qa_item["q"], str):
            q_len = len(qa_item["q"])
            min_len, max_len = SyntaxValidator.CONFIG["q_length"]
            if not (min_len <= q_len <= max_len):
                errors.append(f"Question length {q_len} out of range")
        
        if "a" in qa_item and isinstance(qa_item["a"], str):
            a_len = len(qa_item["a"])
            min_len, max_len = SyntaxValidator.CONFIG["a_length"]
            if not (min_len <= a_len <= max_len):
                errors.append(f"Answer length {a_len} out of range")
        
        if "context" in qa_item and isinstance(qa_item["context"], str):
            ctx_len = len(qa_item["context"])
            min_len, max_len = SyntaxValidator.CONFIG["context_length"]
            if not (min_len <= ctx_len <= max_len):
                errors.append(f"Context length {ctx_len} out of range")
        
        is_valid = len(errors) == 0
        return is_valid, errors


# ============================================================================
# 2️⃣ 품질 평가 (GPT-5.1 LLM 기반)
# ============================================================================

class QualityEvaluator:
    """QA 품질 평가 (Layer 2) - OpenAI GPT-5.1 기반"""
    
    def __init__(self, model: str = "gpt-5.1"):
        """GPT 기반 평가기 초기화"""
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        # 모델 약칭을 실제 API model_id로 변환
        self.model = get_model_id(model)
        self.model_display = model
    
    def _call_llm(self, prompt: str) -> str:
        """LLM 호출"""
        try:
            # 디버그: 실제 사용되는 모델명 출력
            # console.print(f"[dim]→ LLM 호출: model={self.model}[/dim]")
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "Respond with ONLY a single digit (0-10). No explanation."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0,
                max_completion_tokens=100,  # main.py와 동일한 충분한 크기
            )
            
            # 전체 응답 객체 로깅
            if not response or not response.choices:
                console.print(f"[red]❌ 빈 응답 객체 (model={self.model_display})[/red]")
                return "5"
            
            result = response.choices[0].message.content
            if result is None:
                console.print(f"[red]❌ null 응답 (model={self.model_display})[/red]")
                return "5"
            
            result = result.strip()
            
            # 숫자만 추출 (혹시 다른 텍스트가 포함되었을 경우)
            digits = [c for c in result if c.isdigit()]
            if not digits:
                console.print(f"[red]❌ 'N/A' (model={self.model_display}, raw={result!r})[/red]")
                return "5"
            
            return digits[0]  # 첫 번째 숫자만 사용
            
        except Exception as e:
            import traceback
            error_type = type(e).__name__
            error_msg = str(e)
            console.print(f"[red]❌ API 오류 ({error_type}): {error_msg[:100]}[/red]")
            if "api_key" in error_msg.lower() or "401" in error_msg:
                console.print(f"[yellow]💡 확인: OPENAI_API_KEY 설정됨?[/yellow]")
            if "model" in error_msg.lower() or "404" in error_msg:
                console.print(f"[yellow]💡 확인: gpt-5.1 모델명 정확함?[/yellow]")
            return "5"
    
    def _call_llm_with_reasoning(self, prompt: str) -> str:
        """CoT 방식 LLM 호출 - 추론 후 점수 반환"""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a strict but fair data quality auditor. Think step by step, then provide your score."
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0,
                max_completion_tokens=300,
            )
            
            if not response or not response.choices:
                return "Score: 5"
            
            result = response.choices[0].message.content
            if result is None:
                return "Score: 5"
            
            return result.strip()
            
        except Exception as e:
            error_msg = str(e)
            console.print(f"[red]❌ API 오류: {error_msg[:100]}[/red]")
            return "Score: 5"
    
    def _parse_cot_score(self, raw: str) -> float:
        """CoT 응답에서 Score 파싱"""
        import re
        matches = re.findall(r'Score:\s*(\d+)', raw, re.IGNORECASE)
        if matches:
            score = int(matches[-1])
            return min(10, max(0, score)) / 10.0
        # fallback: 마지막 숫자 추출
        digits = re.findall(r'\b(\d+)\b', raw)
        if digits:
            score = int(digits[-1])
            return min(10, max(0, score)) / 10.0
        return 0.5

    def evaluate_factuality(self, answer: str, context: str) -> float:
        """사실성 평가 (0-1) - 의미 기반 CoT 평가"""
        clean_ctx = clean_markdown(context)
        
        prompt = f"""You are a strict data quality auditor evaluating FACTUAL ACCURACY.

CRITICAL RULES:
- Evaluate SEMANTIC MEANING, not word-for-word matching.
- Paraphrasing or summarizing the same fact = ACCURATE.
- Only penalize if the answer states something CONTRARY to the context.
- Ignore markdown noise or formatting differences in the context.

[CONTEXT]
{clean_ctx[:4000]}

[ANSWER]
{answer}

[TASK]
Step 1: Find the key claims in the answer.
Step 2: Check if each claim is supported by (or at least not contradicted by) the context.
Step 3: Give a score.

[SCALE]
10: All claims semantically match the context
8-9: Nearly all claims match, trivial gaps
6-7: Core claims match, minor discrepancies
4-5: Some claims unsupported or partially wrong
1-3: Most claims contradict or cannot be derived from context
0: Completely contradicts the context

[OUTPUT FORMAT]
Reasoning: <your reasoning>
Score: <digit 0-10>"""
        
        try:
            raw = self._call_llm_with_reasoning(prompt)
            return self._parse_cot_score(raw)
        except Exception:
            return 0.5
    
    def evaluate_completeness(self, question: str, answer: str) -> float:
        """완전성 평가 (0-1) - 답변이 질문을 충분히 다루는가?"""
        prompt = f"""Rate how completely this answer addresses the question.

[QUESTION]
{question}

[ANSWER]
{answer}

[TASK]
Evaluate: Does the answer address the main points of the question?
(It's okay if some details are missing, but the core question should be answered.)

[SCALE]
10: Comprehensive answer to all aspects
8-9: Addresses main points well
6-7: Addresses core question but lacks some detail
4-5: Partially addresses question
1-3: Minimal coverage
0: Doesn't address question

[OUTPUT]
Respond with ONLY a single digit (0-10)."""
        
        try:
            response = self._call_llm(prompt)
            score = int(response.strip())
            return min(10, max(0, score)) / 10.0
        except ValueError:
            return 0.5
    
    def evaluate_groundedness(self, answer: str, context: str) -> float:
        """근거성 평가 (0-1) - 의미 기반 CoT 평가"""
        clean_ctx = clean_markdown(context)
        
        prompt = f"""You are a strict data quality auditor evaluating GROUNDEDNESS.

CRITICAL RULES:
- Do NOT require exact quotes or identical wording.
- If the answer's meaning can be DERIVED or INFERRED from the context, it is grounded.
- Paraphrasing, synonyms, and natural summarization all count as grounded.
- Only penalize if the answer asserts something the context does NOT support at all.
- Ignore markdown noise or formatting in the context.

[CONTEXT]
{clean_ctx[:4000]}

[ANSWER]
{answer}

[TASK]
Step 1: Identify the main claims in the answer.
Step 2: For each claim, check if it can be derived (not necessarily quoted) from the context.
Step 3: Give a score.

[SCALE]
10: All claims clearly derivable from context
8-9: Nearly all claims derivable, trivial additions
6-7: Core claims derivable, some minor unsupported details
4-5: Mixed - some claims derivable, others unclear
1-3: Most claims cannot be traced to context
0: Contradicts or is completely unrelated to context

[OUTPUT FORMAT]
Reasoning: <your reasoning>
Score: <digit 0-10>"""
        
        try:
            raw = self._call_llm_with_reasoning(prompt)
            return self._parse_cot_score(raw)
        except Exception:
            return 0.5


# ============================================================================
# 1-B. 데이터셋 통계 (Dataset Statistics)
# ============================================================================

class DatasetStats:
    """QA 데이터셋 통계 분석 (Layer 1-B)"""

    def __init__(self, qa_list: List[Dict]):
        self.qa_list = qa_list
        self.results = {}

    def analyze_all(self) -> Dict:
        """모든 통계 지표 계산"""
        self.results = {
            "diversity": self._analyze_diversity(),
            "duplication_rate": self._analyze_duplication_rate(),
            "skewness": self._analyze_skewness(),
            "data_sufficiency": self._analyze_data_sufficiency(),
        }
        self.results["integrated_score"] = self._calculate_integrated_score()
        return self.results

    def _analyze_diversity(self) -> Dict:
        """다양성 (0-10) - intent 커버리지 + 어휘 다양도 + intent 균형도 통합"""
        intent_dist = Counter([qa.get("intent", "unknown") for qa in self.qa_list])
        doc_dist = Counter([qa.get("docId", "unknown") for qa in self.qa_list])
        total = max(len(self.qa_list), 1)

        intent_coverage = len(intent_dist) / total
        doc_coverage = len(doc_dist) / total

        all_q_words = [w for qa in self.qa_list for w in qa.get("q", "").split()]
        vocabulary_diversity = len(set(all_q_words)) / max(len(all_q_words), 1)

        intent_values = list(intent_dist.values())
        intent_balance = min(intent_values) / max(intent_values) if intent_values and max(intent_values) > 0 else 0

        score = (intent_coverage + doc_coverage + vocabulary_diversity + intent_balance) / 4 * 10

        q_lengths = [len(qa.get("q", "")) for qa in self.qa_list]
        a_lengths = [len(qa.get("a", "")) for qa in self.qa_list]
        q_avg = sum(q_lengths) / len(q_lengths) if q_lengths else 0
        a_avg = sum(a_lengths) / len(a_lengths) if a_lengths else 0
        q_std = (sum((x - q_avg) ** 2 for x in q_lengths) / len(q_lengths)) ** 0.5 if q_lengths else 0
        a_std = (sum((x - a_avg) ** 2 for x in a_lengths) / len(a_lengths)) ** 0.5 if a_lengths else 0

        return {
            "score": round(min(10, score), 2),
            "intent_type_count": len(intent_dist),
            "doc_count": len(doc_dist),
            "vocabulary_diversity": round(vocabulary_diversity, 3),
            "intent_balance": round(intent_balance, 3),
            "intent_distribution": dict(intent_dist),
            "question_length": {"avg": round(q_avg, 2), "std": round(q_std, 2)},
            "answer_length": {"avg": round(a_avg, 2), "std": round(a_std, 2)},
        }

    def _analyze_duplication_rate(self) -> Dict:
        """중복률 (0-10) - Near-duplicate 질문 비율"""
        duplicates = []
        checked = set()

        for i, qa_i in enumerate(self.qa_list):
            if i in checked:
                continue
            q_i = qa_i.get("q", "").lower()
            for j, qa_j in enumerate(self.qa_list[i + 1:], start=i + 1):
                if j in checked:
                    continue
                q_j = qa_j.get("q", "").lower()
                if SequenceMatcher(None, q_i, q_j).ratio() >= 0.7:
                    duplicates.append({"pair": (i, j)})
                    checked.add(j)

        total_pairs = len(self.qa_list) * (len(self.qa_list) - 1) / 2 if len(self.qa_list) > 1 else 1
        near_dup_rate = len(duplicates) / max(total_pairs, 1) * 100

        return {
            "score": round(min(10, max(0, (100 - near_dup_rate) / 10)), 2),
            "duplicate_count": len(duplicates),
            "near_duplicate_rate": round(near_dup_rate, 2),
        }

    def _analyze_skewness(self) -> Dict:
        """편중도 (0-10) - 특정 docId 집중도"""
        doc_dist = Counter([qa.get("docId", "unknown") for qa in self.qa_list])
        intent_dist = Counter([qa.get("intent", "unknown") for qa in self.qa_list])
        doc_max_ratio = max(doc_dist.values()) / sum(doc_dist.values()) * 100 if doc_dist else 0

        if doc_max_ratio <= 50:
            score = 10
        elif doc_max_ratio <= 70:
            score = 7
        else:
            score = max(0, 10 - (doc_max_ratio - 70) / 10)

        return {
            "score": round(min(10, score), 2),
            "doc_max_ratio": round(doc_max_ratio, 2),
            "doc_distribution": dict(doc_dist),
            "intent_max_ratio": round(max(intent_dist.values()) / sum(intent_dist.values()) * 100 if intent_dist else 0, 2),
        }

    def _analyze_data_sufficiency(self) -> Dict:
        """데이터 충족률 (0-10) - 필드 채움률"""
        fields = ["q", "a", "context", "docId", "intent"]
        fill_rates = {}
        for field in fields:
            filled = sum(1 for qa in self.qa_list if field in qa and qa[field])
            fill_rates[field] = round(filled / max(len(self.qa_list), 1) * 100, 2)

        avg_fill = sum(fill_rates.values()) / len(fill_rates) if fill_rates else 0

        return {
            "score": round(min(10, avg_fill / 10), 2),
            "field_fill_rates": fill_rates,
        }

    def _calculate_integrated_score(self) -> float:
        """통합 점수 (0-10)"""
        integrated = (
            self.results["diversity"]["score"] * 0.30
            + self.results["duplication_rate"]["score"] * 0.25
            + self.results["skewness"]["score"] * 0.35
            + self.results["data_sufficiency"]["score"] * 0.10
        )
        return round(integrated, 2)


# ============================================================================
# 4️⃣ 데이터 로드
# ============================================================================

def load_qa_data(filepath: str, limit: Optional[int] = None) -> List[Dict]:
    """QA 파일 로드"""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    qa_list = []
    doc_count = 0
    qa_count = 0
    
    for result in data.get("results", []):
        try:
            raw_data = json.loads(result["raw"])
            context = result.get("text", "")
            
            for qa in raw_data.get("qa_list", []):
                if limit and qa_count >= limit:
                    break
                
                qa_list.append({
                    "q": qa.get("q", ""),
                    "a": qa.get("a", ""),
                    "context": context,
                    "docId": result.get("docId", ""),
                    "intent": qa.get("intent", ""),
                })
                qa_count += 1
            
            doc_count += 1
            if limit and qa_count >= limit:
                break
        except Exception as e:
            console.print(f"[yellow]⚠️ 문서 {result.get('docId')} 파싱 오류[/yellow]")
            continue
    
    console.print(f"[cyan]📁 로드됨: {doc_count}개 문서, {qa_count}개 QA[/cyan]")
    return qa_list


# ============================================================================
# 5️⃣ 메인 실행
# ============================================================================

def main(qa_list: List[Dict], model: str = "gpt-5.1"):
    """QA 품질 평가 (2-Layer)"""

    console.print(Panel(
        f"[bold blue]QA 데이터 품질 평가 (2-Layer with {MODEL_CONFIG.get(model, {}).get('name', model)})[/bold blue]",
        box=box.ROUNDED,
    ))

    # ── Layer 1-A: 구문 정확성 ──────────────────────────────────────────────
    console.print("\n[bold]📍 Layer ①-A: 구문 정확성 검증[/bold]")
    validator = SyntaxValidator()
    syntax_valid_indices = []

    for i, qa in enumerate(qa_list):
        is_valid, errors = validator.validate_qa(qa)
        if is_valid:
            syntax_valid_indices.append(i)

    syntax_pass = len(syntax_valid_indices)
    syntax_rate = syntax_pass / len(qa_list) * 100 if qa_list else 0
    console.print(f"✅ 구문 검증: {syntax_pass}/{len(qa_list)} ({syntax_rate:.1f}%)")

    # ── Layer 1-B: 데이터셋 통계 ──────────────────────────────────────────
    console.print("\n[bold]📍 Layer ①-B: 데이터셋 통계[/bold]")
    stats = DatasetStats(qa_list)
    dataset_stats = stats.analyze_all()

    stat_table = Table(title="데이터셋 통계 (0-10)", box=box.SIMPLE)
    stat_table.add_column("지표", style="cyan", width=16)
    stat_table.add_column("점수", justify="right", style="yellow", width=10)
    stat_table.add_column("평가", style="magenta", width=16)

    stat_items = [
        ("다양성",        dataset_stats["diversity"]["score"]),
        ("중복률",        dataset_stats["duplication_rate"]["score"]),
        ("편중도",        dataset_stats["skewness"]["score"]),
        ("데이터 충족률",  dataset_stats["data_sufficiency"]["score"]),
        ("통합점수",      dataset_stats["integrated_score"]),
    ]
    for label, score in stat_items:
        grade = "⭐ Excellent" if score >= 9 else ("✓ Good" if score >= 7 else ("→ Fair" if score >= 5 else "✗ Poor"))
        stat_table.add_row(label, f"{score:.2f}/10", grade)

    console.print(stat_table)

    # ── Layer 2: LLM 품질 평가 ──────────────────────────────────────────────
    console.print(f"\n[bold]📍 Layer ②: LLM 품질 평가 ({MODEL_CONFIG.get(model, {}).get('name', model)})[/bold]")
    evaluator = QualityEvaluator(model=model)
    qa_quality_results = []

    for idx in syntax_valid_indices:
        qa = qa_list[idx]
        question = qa.get("q", "")
        answer = qa.get("a", "")
        context = qa.get("context", "")

        console.print(f"[cyan]📊 QA #{idx+1}[/cyan]: {question[:40]}...", end="")

        try:
            factuality   = evaluator.evaluate_factuality(answer, context)
            completeness = evaluator.evaluate_completeness(question, answer)
            groundedness = evaluator.evaluate_groundedness(answer, context)
            avg_score    = (factuality + completeness + groundedness) / 3

            qa_quality_results.append({
                "index":        idx + 1,
                "question":     question,
                "answer":       answer,
                "factuality":   round(factuality,   3),
                "completeness": round(completeness, 3),
                "groundedness": round(groundedness, 3),
                "avg_quality":  round(avg_score,    3),
                "pass":         avg_score >= 0.70,
            })

            status = "[green]✓[/green]" if avg_score >= 0.70 else "[red]✗[/red]"
            console.print(f" {status} | 사실:{factuality:.2f} 완결:{completeness:.2f} 근거:{groundedness:.2f} 종합:{avg_score:.2f}")

        except Exception:
            console.print(" [red]오류[/red]")
            continue

    # Layer 2 요약
    if qa_quality_results:
        passed       = sum(1 for r in qa_quality_results if r["pass"])
        pass_rate    = passed / len(qa_quality_results) * 100
        avg_f  = sum(r["factuality"]   for r in qa_quality_results) / len(qa_quality_results)
        avg_c  = sum(r["completeness"] for r in qa_quality_results) / len(qa_quality_results)
        avg_g  = sum(r["groundedness"] for r in qa_quality_results) / len(qa_quality_results)
        avg_q  = sum(r["avg_quality"]  for r in qa_quality_results) / len(qa_quality_results)

        console.print(f"\n[bold]Layer 2 요약:[/bold]")
        console.print(f"  • 통과: {passed}/{len(qa_quality_results)} ({pass_rate:.1f}%)")
        console.print(f"  • 평균 사실성: {avg_f:.3f}")
        console.print(f"  • 평균 완결성: {avg_c:.3f}")
        console.print(f"  • 평균 근거성: {avg_g:.3f}")
        console.print(f"  • 평균 종합:   {avg_q:.3f}")

    # ── 결과 저장 ──────────────────────────────────────────────────────────
    output_data = {
        "metadata": {
            "total_qa":      len(qa_list),
            "syntax_valid":  syntax_pass,
            "llm_evaluated": len(qa_quality_results),
            "timestamp":     datetime.now().isoformat(),
            "llm_model":     model,
            "llm_model_id":  get_model_id(model),
        },
        "layer_1_syntax": {
            "pass_count": syntax_pass,
            "pass_rate":  round(syntax_rate, 2),
        },
        "layer_1_stats": dataset_stats,
        "layer_2_quality": {
            "qa_scores": qa_quality_results,
            "summary": {
                "evaluated_count":   len(qa_quality_results),
                "pass_count":        sum(1 for r in qa_quality_results if r["pass"]),
                "pass_rate":         round(sum(1 for r in qa_quality_results if r["pass"]) / len(qa_quality_results) * 100, 2) if qa_quality_results else 0,
                "avg_factuality":    round(sum(r["factuality"]   for r in qa_quality_results) / len(qa_quality_results), 3) if qa_quality_results else 0,
                "avg_completeness":  round(sum(r["completeness"] for r in qa_quality_results) / len(qa_quality_results), 3) if qa_quality_results else 0,
                "avg_groundedness":  round(sum(r["groundedness"] for r in qa_quality_results) / len(qa_quality_results), 3) if qa_quality_results else 0,
                "avg_quality":       round(sum(r["avg_quality"]  for r in qa_quality_results) / len(qa_quality_results), 3) if qa_quality_results else 0,
            },
        },
    }

    output_dir = Path("validated_output")
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / f"qa_quality_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    console.print(f"\n✅ 결과 저장: {output_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QA 데이터 품질 평가 (2-Layer with GPT-5.1)")
    parser.add_argument("--input", type=str, required=True, help="QA 파일 경로")
    parser.add_argument("--limit", type=int, default=None, help="최대 평가 QA 개수")
    parser.add_argument("--model", type=str, default="gpt-5.1", help="평가 모델 (기본값: gpt-5.1)")
    args = parser.parse_args()
    
    console.print(f"[cyan]📂 파일 로드 중: {args.input}[/cyan]")
    qa_list = load_qa_data(args.input, limit=args.limit)
    
    if not qa_list:
        console.print("[red]❌ QA 데이터를 로드할 수 없습니다[/red]")
        exit(1)
    
    main(qa_list, model=args.model)
