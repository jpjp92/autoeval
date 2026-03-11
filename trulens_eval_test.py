#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TruLens를 활용한 RAG QA 평가 시스템

📋 개요:
  - RAG Triad 평가 프레임워크 (Relevance, Groundedness, Clarity)
  - TruLens Feedback Functions로 구현
  - 실제 QA 데이터 평가
  - 결과를 JSON 및 Leaderboard로 출력

🔧 평가 방식:
  - Judge Model: Gemini 2.5 Flash
  - 평가 항목: 관련성(0-1), 근거성(0-1), 명확성(0-1)
  - 통과 기준: 평균 >= 0.70

📊 사용 방법:
  uv run trulens_eval_test.py --input FILE       # 실제 데이터 평가
  uv run trulens_eval_test.py --input FILE --limit 10  # 10개 QA만 평가

📁 출력:
  - Console: 평가 과정 및 결과 테이블
  - JSON: validated_output/trulens_eval_results_*.json
  - Leaderboard: TruLens 데이터베이스
"""

import json
import os
import argparse
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

try:
    from trulens.core import TruSession
    from trulens.core.otel.instrument import instrument
    from trulens.otel.semconv.trace import SpanAttributes
    from trulens.core import Metric, Selector
    from trulens.apps.app import TruApp
    from trulens.providers.openai import OpenAI as TruOpenAI
    from langchain_google_genai import ChatGoogleGenerativeAI
    import numpy as np
except ImportError as e:
    print(f"오류: 필수 라이브러리 설치 필요: {e}")
    print("설치: uv add trulens trulens-providers-openai langchain-google-genai")
    exit(1)

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box

console = Console()


# ============================================================================
# 1️⃣ RAG Triad 평가 클래스 (Relevance, Groundedness, Clarity)
# ============================================================================
# TruLens를 통해 우리의 평가 로직을 Feedback Functions로 구현

class RAGTriadEvaluator:
    """우리의 RAG Triad 평가 로직을 TruLens Metric으로 구현"""

    def __init__(self):
        self.judge_llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            temperature=0
        )

    def evaluate_relevance(self, question: str, answer: str) -> float:
        """
        Relevance: 답변이 질문에 답하는가?
        Returns: 0-1 (TruLens 표준 스케일)
        """
        prompt = f"""Rate the relevance of the answer to the question on a scale of 0-10.

Question: {question}
Answer: {answer}

Return ONLY a single integer (0-10) with no explanation."""

        response = self.judge_llm.invoke(prompt).content.strip()
        try:
            score = int(response.split('\n')[0])
            return min(10, max(0, score)) / 10.0  # 정규화: 0-1
        except:
            return 0.5

    def evaluate_groundedness(self, answer: str, context: str) -> float:
        """
        Groundedness: 답변이 컨텍스트로 뒷받침되는가?
        Returns: 0-1 (TruLens 표준 스케일)
        """
        prompt = f"""You are an expert at assessing whether an answer is grounded in provided context.

Context:
{context}

Answer:
{answer}

Is the answer grounded in the context? Rate on 0-10 scale:
- 10: Directly quoted from or clearly supported by context
- 8-9: Paraphrased but clearly grounded in context
- 7: Conditional language used, but core fact exists in context
- 5-6: Some information from context but with unrelated claims
- 0-4: Not grounded, contains hallucinations or contradictions

Return ONLY a single integer (0-10) with no explanation."""

        response = self.judge_llm.invoke(prompt).content.strip()
        try:
            score = int(response.split('\n')[0])
            return min(10, max(0, score)) / 10.0
        except:
            return 0.5

    def evaluate_clarity(self, question: str, answer: str) -> float:
        """
        Clarity: 질문과 답변이 명확한가?
        Returns: 0-1 (TruLens 표준 스케일)
        """
        prompt = f"""Rate the clarity and comprehensibility of the question-answer pair on 0-10 scale.

Question: {question}
Answer: {answer}

Consider:
- Is the question well-formed and understandable?
- Is the answer clearly written without ambiguities?
- Is the answer properly structured?

Return ONLY a single integer (0-10) with no explanation."""

        response = self.judge_llm.invoke(prompt).content.strip()
        try:
            score = int(response.split('\n')[0])
            return min(10, max(0, score)) / 10.0
        except:
            return 0.5


# ============================================================================
# 2️⃣ RAG 파이프라인 (Retrieval, Generation, Query)
# ============================================================================
# TruLens @instrument 데코레이터로 각 단계 자동 추적

class SimpleRAG:
    """TruLens 계측을 위한 간단한 RAG 구현"""

    def __init__(self, qa_data: Dict):
        self.qa_data = qa_data
        self.evaluator = RAGTriadEvaluator()

    @instrument(
        span_type=SpanAttributes.SpanType.RETRIEVAL,
        attributes={
            SpanAttributes.RETRIEVAL.QUERY_TEXT: "question",
            SpanAttributes.RETRIEVAL.RETRIEVED_CONTEXTS: "return",
        },
    )
    def retrieve(self, question: str) -> str:
        """컨텍스트 조회"""
        return self.qa_data.get("context", "")

    @instrument(span_type=SpanAttributes.SpanType.GENERATION)
    def generate(self, question: str, context: str) -> str:
        """답변 생성 (사실 미리 정해진 답변 사용)"""
        return self.qa_data.get("answer", "")

    @instrument(
        span_type=SpanAttributes.SpanType.RECORD_ROOT,
        attributes={
            SpanAttributes.RECORD_ROOT.INPUT: "question",
            SpanAttributes.RECORD_ROOT.OUTPUT: "return",
        },
    )
    def query(self, question: str) -> str:
        """RAG 파이프라인"""
        context = self.retrieve(question)
        answer = self.generate(question, context)
        return answer


# ============================================================================
# 3️⃣ TruLens 설정 (세션, Metrics, Feedback Functions)
# ============================================================================

def setup_trulens_session():
    """TruLens 세션 초기화"""
    session = TruSession()
    session.reset_database()
    return session


def create_feedback_functions(evaluator: RAGTriadEvaluator) -> List[Metric]:
    """우리의 평가 로직을 TruLens Feedback Functions로 변환"""

    # Relevance 메트릭
    f_relevance = Metric(
        implementation=evaluator.evaluate_relevance,
        name="Relevance",
        selectors={
            "question": Selector.select_record_input(),
            "answer": Selector.select_record_output(),
        },
    )

    # Groundedness 메트릭
    f_groundedness = Metric(
        implementation=evaluator.evaluate_groundedness,
        name="Groundedness",
        selectors={
            "answer": Selector.select_record_output(),
            "context": Selector.select_context(collect_list=True),
        },
    )

    # Clarity 메트릭
    f_clarity = Metric(
        implementation=evaluator.evaluate_clarity,
        name="Clarity",
        selectors={
            "question": Selector.select_record_input(),
            "answer": Selector.select_record_output(),
        },
    )

    return [f_relevance, f_groundedness, f_clarity]


def load_real_data(filepath: str, limit: Optional[int] = None) -> List[Dict]:
    """실제 데이터 파일에서 QA 리스트 로드
    
    Args:
        filepath: QA JSON 파일 경로
        limit: 최대 QA 개수 (None이면 모두 로드)
    
    Returns:
        QA 데이터 리스트: [{"question": str, "answer": str, "context": str}, ...]
    """
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    qa_list = []
    doc_count = 0
    qa_count = 0
    
    for result in data.get("results", []):
        # raw 필드에서 QA 추출 (JSON 문자열 파싱)
        try:
            raw_data = json.loads(result["raw"])
            # context는 전체 text 사용 (더 정확한 평가)
            context = result.get("text", "")
            
            for qa in raw_data.get("qa_list", []):
                if limit and qa_count >= limit:
                    break
                
                qa_list.append({
                    "question": qa.get("q", ""),
                    "answer": qa.get("a", ""),
                    "context": context,
                    "docId": result.get("docId", ""),
                    "intent": qa.get("intent", ""),
                })
                qa_count += 1
            
            doc_count += 1
            if limit and qa_count >= limit:
                break
        except Exception as e:
            console.print(f"[yellow]⚠️ 문서 {result.get('docId')} 파싱 오류: {e}[/yellow]")
            continue
    
    console.print(f"[cyan]📁 로드됨: {doc_count}개 문서, {qa_count}개 QA[/cyan]")
    return qa_list


# ============================================================================
# 4️⃣ 메인 실행 및 CLI
# ============================================================================

def main(qa_data: List[Dict]):
    """TruLens RAG Triad 평가 테스트"""
    
    console.print(Panel(
        "[bold blue]TruLens RAG Triad 평가 테스트[/bold blue]",
        box=box.ROUNDED,
    ))

    console.print(f"📊 데이터 소스: [cyan]실제 데이터[/cyan]")

    # TruLens 세션 초기화
    console.print("\n📍 TruLens 세션 초기화 중...")
    session = setup_trulens_session()

    # 평가기 및 Feedback Functions 생성
    console.print("📍 평가 함수 설정 중...")
    evaluator = RAGTriadEvaluator()
    feedbacks = create_feedback_functions(evaluator)

    # 결과 저장용
    results = []

    # 각 QA 쌍을 평가
    console.print(f"\n📊 {len(qa_data)}개 QA 쌍 평가 중...\n")

    for i, qa_item in enumerate(qa_data, 1):
        question = qa_item["question"]
        answer = qa_item["answer"]
        context = qa_item["context"]

        console.print(f"[cyan]QA #{i}[/cyan]: {question[:50]}...")

        # RAG 초기화
        rag = SimpleRAG(qa_item)

        # TruApp으로 래핑
        tru_rag = TruApp(
            rag,
            app_name="QA_Evaluator",
            app_version=f"sample_v{i}",
            feedbacks=feedbacks,
        )

        # 쿼리 실행 (TruLens가 자동으로 메트릭 계산)
        try:
            with tru_rag as recording:
                result = rag.query(question)

            # 결과 저장
            qa_result = {
                "index": i,
                "question": question,
                "answer": answer,
                "context": context,
                "relevance": evaluator.evaluate_relevance(question, answer),
                "groundedness": evaluator.evaluate_groundedness(answer, context),
                "clarity": evaluator.evaluate_clarity(question, answer),
            }
            qa_result["overall_score"] = np.mean([
                qa_result["relevance"],
                qa_result["groundedness"],
                qa_result["clarity"],
            ])
            qa_result["pass"] = bool(qa_result["overall_score"] >= 0.70)

            results.append(qa_result)
            
            # 결과 출력
            status = "[green]✓ PASS[/green]" if qa_result["pass"] else "[red]✗ FAIL[/red]"
            console.print(
                f"  {status} | "
                f"Relevance: {qa_result['relevance']:.2f} | "
                f"Groundedness: {qa_result['groundedness']:.2f} | "
                f"Clarity: {qa_result['clarity']:.2f}"
            )

        except Exception as e:
            console.print(f"  [red]오류: {e}[/red]")

    # 최종 결과 요약
    console.print("\n" + "=" * 80)
    console.print("[bold]📈 평가 결과 요약[/bold]\n")

    total = len(results)
    passed = sum(1 for r in results if r["pass"])
    pass_rate = (passed / total * 100) if total > 0 else 0

    # 결과 테이블
    table = Table(title="QA 평가 결과", box=box.ROUNDED)
    table.add_column("# ", style="cyan")
    table.add_column("Question", style="magenta")
    table.add_column("Relevance", justify="right", style="yellow")
    table.add_column("Groundedness", justify="right", style="yellow")
    table.add_column("Clarity", justify="right", style="yellow")
    table.add_column("Overall", justify="right", style="bold")
    table.add_column("Result", justify="center")

    for r in results:
        status = "[green]✓[/green]" if r["pass"] else "[red]✗[/red]"
        table.add_row(
            str(r["index"]),
            r["question"][:40] + "...",
            f"{r['relevance']:.2f}",
            f"{r['groundedness']:.2f}",
            f"{r['clarity']:.2f}",
            f"{r['overall_score']:.2f}",
            status,
        )

    console.print(table)

    # 통계
    console.print(f"\n[bold]합계:[/bold]")
    console.print(f"  • 총 QA: {total}")
    console.print(f"  • 통과: {passed} ({pass_rate:.1f}%)")
    console.print(f"  • 실패: {total - passed}")

    avg_relevance = np.mean([r["relevance"] for r in results])
    avg_groundedness = np.mean([r["groundedness"] for r in results])
    avg_clarity = np.mean([r["clarity"] for r in results])

    console.print(f"\n[bold]평균 점수:[/bold]")
    console.print(f"  • Relevance: {avg_relevance:.2f}")
    console.print(f"  • Groundedness: {avg_groundedness:.2f}")
    console.print(f"  • Clarity: {avg_clarity:.2f}")

    # 결과 저장 (validated_output 디렉토리에 저장)
    output_dir = Path("validated_output")
    output_dir.mkdir(exist_ok=True)
    output_file = output_dir / f"trulens_eval_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    console.print(f"\n✅ 결과 저장: {output_file}")

    # TruLens Leaderboard 표시
    console.print("\n[bold cyan]📊 TruLens Leaderboard:[/bold cyan]")
    try:
        leaderboard = session.get_leaderboard()
        console.print(leaderboard)
    except Exception as e:
        console.print(f"[yellow]Leaderboard 조회 오류: {e}[/yellow]")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TruLens RAG Triad 평가")
    parser.add_argument("--input", type=str, required=True, help="QA 파일 경로 (예: output/qa_gpt-5.1_en_v2_20260310_095012.json)")
    parser.add_argument("--limit", type=int, default=None, help="최대 평가 QA 개수")
    args = parser.parse_args()
    
    # 데이터 로드
    console.print(f"[cyan]📂 파일 로드 중: {args.input}[/cyan]")
    qa_data = load_real_data(args.input, limit=args.limit)
    if not qa_data:
        console.print("[red]❌ QA 데이터를 로드할 수 없습니다[/red]")
        exit(1)
    
    main(qa_data)
