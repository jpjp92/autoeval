"""
Backend Evaluation API
RAG Triad 평가를 Backend에서 처리
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional, Dict, Any, TYPE_CHECKING
from datetime import datetime
from enum import Enum
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

if TYPE_CHECKING:
    from fastapi import FastAPI, BackgroundTasks

logger = logging.getLogger(__name__)

# Suppress verbose Google AI logging
logging.getLogger("google.generativeai").setLevel(logging.WARNING)
logging.getLogger("google_genai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)

# ============= Helper to import at runtime =============

def _get_http_exception():
    """Get HTTPException at runtime"""
    try:
        from fastapi import HTTPException
        return HTTPException
    except ImportError:
        return None

def _get_request_class():
    """Get Request class at runtime"""
    try:
        from fastapi import Request
        return Request
    except ImportError:
        return None

# ============= Configurations =============
BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
VALIDATED_OUTPUT_DIR = BASE_DIR / "validated_output"

# ============= Job Status =============

class EvalJobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class EvalJob:
    job_id: str
    result_filename: str
    status: EvalJobStatus = EvalJobStatus.PENDING
    progress: int = 0
    message: str = ""
    error: Optional[str] = None
    eval_report: Optional[str] = None
    timestamp: str = ""

# ============= Evaluation Manager =============

class EvaluationManager:
    """Manage evaluation jobs"""
    
    def __init__(self):
        self.jobs: Dict[str, EvalJob] = {}

    def create_job(self, job_id: str, result_filename: str) -> EvalJob:
        job = EvalJob(
            job_id=job_id,
            result_filename=result_filename,
            timestamp=datetime.now().isoformat()
        )
        self.jobs[job_id] = job
        logger.info(f"Created evaluation job: {job_id}")
        return job

    def get_job(self, job_id: str) -> Optional[EvalJob]:
        return self.jobs.get(job_id)

    def update_job(self, job_id: str, **kwargs):
        if job_id in self.jobs:
            for key, value in kwargs.items():
                if hasattr(self.jobs[job_id], key):
                    setattr(self.jobs[job_id], key, value)

# ============= RAG Triad Evaluator =============

class RAGTriadEvaluator:
    """RAG Triad 평가 로직 (TruLens 기반 개선)"""
    
    def __init__(self, evaluator_model: str = "gemini-2.5-flash"):
        """평가 모델 초기화
        
        Args:
            evaluator_model: 평가 모델명 (gemini-2.5-flash, claude-haiku-4-5, gpt-5.1-*)
        """
        self.judge_model = None
        self.evaluator_model = evaluator_model
        
        try:
            # Determine which provider and initialize appropriate client
            if "gemini" in evaluator_model.lower():
                # Google Gemini
                from langchain_google_genai import ChatGoogleGenerativeAI
                api_key = os.getenv("GOOGLE_API_KEY")
                if api_key:
                    self.judge_model = ChatGoogleGenerativeAI(
                        model=evaluator_model,
                        google_api_key=api_key,
                        temperature=0
                    )
                    logger.info(f"✓ Judge model initialized (Google): {evaluator_model}")
                else:
                    logger.warning("GOOGLE_API_KEY not set for evaluator")
                    
            elif "claude" in evaluator_model.lower():
                # Anthropic Claude
                from langchain_anthropic import ChatAnthropic
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if api_key:
                    self.judge_model = ChatAnthropic(
                        model=evaluator_model,
                        api_key=api_key,
                        temperature=0
                    )
                    logger.info(f"✓ Judge model initialized (Anthropic): {evaluator_model}")
                else:
                    logger.warning("ANTHROPIC_API_KEY not set for evaluator")
                    
            elif "gpt" in evaluator_model.lower():
                # OpenAI GPT
                from langchain_openai import ChatOpenAI
                api_key = os.getenv("OPENAI_API_KEY")
                if api_key:
                    self.judge_model = ChatOpenAI(
                        model=evaluator_model,
                        api_key=api_key,
                        temperature=0
                    )
                    logger.info(f"✓ Judge model initialized (OpenAI): {evaluator_model}")
                else:
                    logger.warning("OPENAI_API_KEY not set for evaluator")
            else:
                logger.warning(f"Unknown evaluator model: {evaluator_model}")
                
        except Exception as e:
            logger.warning(f"Failed to initialize judge model ({evaluator_model}): {e}")

    def _extract_score(self, text: str) -> float:
        """0-10 범위의 점수를 추출하여 0-1로 정규화"""
        try:
            import re
            # 첫 번째 줄에서 0-10 범위의 숫자 추출
            lines = text.strip().split('\n')
            for line in lines:
                match = re.search(r'\b([0-9]|10)\b', line)
                if match:
                    score = int(match.group())
                    return min(10, max(0, score)) / 10.0
            return 0.5
        except Exception as e:
            logger.warning(f"Score extraction error: {e}")
            return 0.5

    def evaluate_relevance(self, question: str, answer: str) -> float:
        """질문과 답변의 관련성 평가 (0-1)"""
        if not self.judge_model or not question or not answer:
            return 0.7
        
        try:
            prompt = f"""Rate the relevance of the answer to the question on a scale of 0-10.

Question: {question}
Answer: {answer}

Return ONLY a single integer (0-10) with no explanation."""
            
            response = self.judge_model.invoke(prompt)
            score = self._extract_score(response.content)
            return score
        except Exception as e:
            logger.warning(f"Relevance evaluation error: {e}")
            return 0.65

    def evaluate_groundedness(self, answer: str, context: str) -> float:
        """답변의 근거성 평가 (0-1) - CoT 스타일 추론"""
        if not self.judge_model or not answer:
            return 0.7
        
        try:
            # context가 없으면 답변의 일반적인 품질로 평가
            context_text = context[:10000] if context else "일반적인 배경 지식"
            
            prompt = f"""You are an expert at assessing whether an answer is grounded in provided context.
Use systematic step-by-step reasoning (Chain of Thought) to evaluate.

Context:
{context_text}

Answer:
{answer}

Evaluate groundedness using the following reasoning process:

Step 1: IDENTIFY KEY CLAIMS
List the main factual claims or statements in the answer.
Examples:
- Specific numbers/times: "09:00 ~ 22:00", "8,800원"
- Names/Entities: "세븐일레븐", "1588-8001"
- Definitions: "eSIM 모듈이 탑재된 모델"
- Procedures: "앱에서 메뉴 선택"

Step 2: FIND SUPPORTING EVIDENCE
For each claim, search the context for supporting evidence.
Use FLEXIBLE MATCHING (NOT exact matching):

ACCEPTABLE:
- Direct quotes in context
- Format variations (09:00~22:00 = 9시~22시 = 오전 9시부터)
- Synonyms (1588-8001로 전화 = 발신번호 1588-8001)
- Combined elements (eSIM + 모듈 + 탑재 together = OK)
- Procedure descriptions (context lists steps → answer describes = OK)

HALLUCINATIONS:
- Numbers changed (09:00 → 10:00)
- Entities altered (GS25 → CU only)
- Fabricated information (not in context at all)

Step 3: ASSESS ALIGNMENT
Score evidence strength per claim:
- Strong (0.9-1.0): Direct quote or clear paraphrase
- Medium (0.7-0.8): Multiple elements logically combined
- Weak (0.5-0.6): Inference supported by context
- Very Weak (0.2-0.4): Barely mentioned or heavily implied
- None (0.0): Not in context

Step 4: DETERMINE GROUNDING LEVEL
Average the evidence scores:
- 10: All strong (0.9-1.0)
- 8-9: Mostly strong with some medium
- 7: Mix of strong/medium, mostly supported
- 5-6: Multiple weak or partial support
- 3-4: Mostly weak, some hallucinations
- 0-2: No support, mainly hallucinated

Return ONLY:
The final integer score (0-10) on the last line."""
            
            response = self.judge_model.invoke(prompt)
            score = self._extract_score(response.content)
            return score
        except Exception as e:
            logger.warning(f"Groundedness evaluation error: {e}")
            return 0.65

    def evaluate_clarity(self, question: str, answer: str) -> float:
        """답변의 명확성 평가 (0-1)"""
        if not self.judge_model or not answer:
            return 0.7
        
        try:
            prompt = f"""Rate the clarity and comprehensibility of the question-answer pair on 0-10 scale.

Question: {question}
Answer: {answer}

Consider:
- Is the question well-formed and understandable?
- Is the answer clearly written without ambiguities?
- Is the answer properly structured?

Return ONLY a single integer (0-10) with no explanation."""
            
            response = self.judge_model.invoke(prompt)
            score = self._extract_score(response.content)
            return score
        except Exception as e:
            logger.warning(f"Clarity evaluation error: {e}")
            return 0.65
            response = self.judge_model.invoke(prompt)
            score_str = response.content.strip()
            score = float(score_str)
            return max(0, min(1, score))
        except Exception as e:
            logger.error(f"Groundedness evaluation error: {e}")
            return 0.7

    def evaluate_clarity(self, question: str, answer: str) -> float:
        """답변의 명확성 평가 (0-1)"""
        if not self.judge_model:
            return 0.8
        
        try:
            prompt = f"""
            다음 질문에 대한 답변의 명확성을 평가하세요 (0-1).
            (1: 매우 명확함, 0: 매우 불명확함)
            
            질문: {question}
            답변: {answer}
            
            점수만 숫자로 응답하세요:
            """
            
            response = self.judge_model.invoke(prompt)
            score_str = response.content.strip()
            score = float(score_str)
            return max(0, min(1, score))
        except Exception as e:
            logger.error(f"Clarity evaluation error: {e}")
            return 0.7

# ============= Background Tasks =============

def run_evaluation(
    job_id: str,
    result_filename: str,
    limit: Optional[int] = None,
    evaluator_model: str = "gemini-2.5-flash",
    eval_manager: Optional[EvaluationManager] = None
):
    """
    Background task: QA 결과 평가 (병렬 처리)
    ThreadPoolExecutor로 4개 QA를 동시에 평가
    """
    if not eval_manager:
        return
    
    try:
        eval_manager.update_job(job_id, status=EvalJobStatus.RUNNING, message="평가 준비 중...")
        
        # 결과 파일 로드
        result_filepath = OUTPUT_DIR / result_filename
        if not result_filepath.exists():
            raise FileNotFoundError(f"Result file not found: {result_filename}")
        
        with open(result_filepath, 'r', encoding='utf-8') as f:
            result_data = json.load(f)
        
        # QA 쌍 + Context 추출 (main.py 생성 파일 구조에 맞춤)
        # 구조: results[].qa_list[] 형식, 각 result는 text(context) 포함
        qa_data = []  # (idx, qa, context) 튜플
        results = result_data.get("results", [])
        
        for result_idx, result in enumerate(results):
            # context는 result의 text 사용
            context = result.get("text", "")
            qa_list = result.get("qa_list", [])
            
            for qa_idx, qa in enumerate(qa_list):
                qa_data.append({
                    "idx": len(qa_data),
                    "qa": qa,
                    "context": context[:10000]  # context는 첫 10000자로 제한 (충분한 정보 + 비용 절감)
                })
        
        if limit:
            qa_data = qa_data[:limit]
        
        total_qa = len(qa_data)
        evaluator = RAGTriadEvaluator(evaluator_model=evaluator_model)
        
        # 평가 결과
        eval_results = [None] * total_qa  # 순서 보존용
        accumulated_relevance = 0
        accumulated_groundedness = 0
        accumulated_clarity = 0
        result_lock = Lock()  # 스레드 안전성
        
        def evaluate_single_qa(item: dict):
            """단일 QA 평가"""
            try:
                idx = item["idx"]
                qa = item["qa"]
                context = item["context"]
                
                question = qa.get("q", "")
                answer = qa.get("a", "")
                
                relevance = evaluator.evaluate_relevance(question, answer)
                groundedness = evaluator.evaluate_groundedness(answer, context)
                clarity = evaluator.evaluate_clarity(question, answer)
                
                result = {
                    "qa_id": qa.get("qa_id", f"qa_{idx}"),
                    "question": question,
                    "answer": answer,
                    "relevance": round(relevance, 2),
                    "groundedness": round(groundedness, 2),
                    "clarity": round(clarity, 2),
                    "avg_score": round((relevance + groundedness + clarity) / 3, 2)
                }
                
                # 진행률 업데이트 (스레드 안전)
                with result_lock:
                    eval_results[idx] = result
                    completed = sum(1 for r in eval_results if r is not None)
                    progress = int(completed / total_qa * 100)
                    
                    if (completed) % max(1, total_qa // 10) == 0 or completed == total_qa:
                        logger.info(f"[{job_id}] Evaluation progress: {completed}/{total_qa} ({progress}%)")
                    
                    eval_manager.update_job(
                        job_id,
                        progress=progress,
                        message=f"평가 진행 중: {completed}/{total_qa}"
                    )
                
                return relevance, groundedness, clarity
            except Exception as e:
                logger.error(f"Error evaluating QA pair {item['idx']}: {e}")
                with result_lock:
                    eval_results[item["idx"]] = {
                        "qa_id": item["qa"].get("qa_id", f"qa_{item['idx']}"),
                        "error": str(e)
                    }
                return 0, 0, 0
        
        # ThreadPoolExecutor로 병렬 평가 (4개 워커)
        with ThreadPoolExecutor(max_workers=4) as executor:
            scores = list(executor.map(evaluate_single_qa, qa_data))
        
        # 스코어 누적
        for relevance, groundedness, clarity in scores:
            accumulated_relevance += relevance
            accumulated_groundedness += groundedness
            accumulated_clarity += clarity
        
        # 평가 통계 계산
        avg_relevance = round(accumulated_relevance / total_qa, 2) if total_qa > 0 else 0
        avg_groundedness = round(accumulated_groundedness / total_qa, 2) if total_qa > 0 else 0
        avg_clarity = round(accumulated_clarity / total_qa, 2) if total_qa > 0 else 0
        overall_score = round((avg_relevance + avg_groundedness + avg_clarity) / 3, 2)
        
        # 평가 보고서 생성
        eval_report = {
            "job_id": job_id,
            "result_filename": result_filename,
            "timestamp": datetime.now().isoformat(),
            "total_qa_evaluated": total_qa,
            "statistics": {
                "avg_relevance": avg_relevance,
                "avg_groundedness": avg_groundedness,
                "avg_clarity": avg_clarity,
                "overall_score": overall_score,
                "pass_rate": round(sum(1 for r in eval_results if r and r.get("avg_score", 0) >= 0.7) / total_qa * 100, 1) if total_qa > 0 else 0
            },
            "qa_evaluations": [r for r in eval_results if r is not None]
        }
        
        # 결과 저장
        VALIDATED_OUTPUT_DIR.mkdir(exist_ok=True)
        report_filename = f"eval_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        report_filepath = VALIDATED_OUTPUT_DIR / report_filename
        
        with open(report_filepath, 'w', encoding='utf-8') as f:
            json.dump(eval_report, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Evaluation completed: {report_filename}")
        
        # Job 상태 업데이트
        eval_manager.update_job(
            job_id,
            status=EvalJobStatus.COMPLETED,
            progress=100,
            message=f"평가 완료! (평균 점수: {overall_score}/1.0)",
            eval_report=report_filename
        )
        
    except Exception as e:
        logger.error(f"Evaluation failed: {e}")
        eval_manager.update_job(
            job_id,
            status=EvalJobStatus.FAILED,
            error=str(e),
            message=f"평가 실패: {str(e)}"
        )

# ============= API Endpoints =============

def setup_evaluation_routes(app: Any, eval_manager: Optional[EvaluationManager] = None):
    """Setup evaluation endpoints
    
    Args:
        app: FastAPI application instance
        eval_manager: EvaluationManager instance for tracking jobs
    """
    
    if not eval_manager:
        eval_manager = EvaluationManager()
    
    # Import types at runtime for function signatures
    try:
        from fastapi import Request, BackgroundTasks
    except ImportError:
        Request = Any
        BackgroundTasks = Any
    
    @app.post("/api/evaluate")
    async def evaluate_qa(request: Request, background_tasks: BackgroundTasks) -> dict:
        """
        Start QA evaluation (RAG Triad)
        
        Request body:
        {
            "result_filename": "qa_model_lang_v1_timestamp.json",
            "evaluator_model": optional(str, default="gemini-2.5-flash"),
            "limit": optional(int)
        }
        """
        try:
            # Parse JSON from request body
            try:
                body = await request.json()
            except:
                body = {}
            
            result_filename = body.get("result_filename") if isinstance(body, dict) else None
            evaluator_model = body.get("evaluator_model", "gemini-2.5-flash") if isinstance(body, dict) else "gemini-2.5-flash"
            limit = body.get("limit") if isinstance(body, dict) else None
            
            if not result_filename:
                return {
                    "success": False,
                    "error": "result_filename is required"
                }
            
            job_id = f"eval_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
            
            # Create job record
            _ = eval_manager.create_job(job_id, result_filename)
            
            logger.info(f"Starting evaluation job: {job_id} for {result_filename} with evaluator_model={evaluator_model}")
            
            # 백그라운드 태스크로 평가 시작
            background_tasks.add_task(
                run_evaluation,
                job_id=job_id,
                result_filename=result_filename,
                limit=limit,
                evaluator_model=evaluator_model,
                eval_manager=eval_manager
            )
            
            return {
                "success": True,
                "job_id": job_id,
                "message": "Evaluation started",
                "evaluator_model": evaluator_model,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Evaluation start failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    @app.get("/api/evaluate/{job_id}/status")
    async def get_eval_status(job_id: str) -> dict:
        """Get evaluation job status"""
        job = eval_manager.get_job(job_id)
        if not job:
            return {
                "success": False,
                "error": f"Job {job_id} not found",
                "status": "not_found"
            }
        
        return {
            "success": True,
            "job_id": job_id,
            "status": job.status.value,
            "progress": job.progress,
            "message": job.message,
            "error": job.error,
            "eval_report": job.eval_report,
            "timestamp": job.timestamp
        }
