"""
Backend Evaluation API
구문정확성, 통계, RAG Triad, quality 평가를 Backend에서 처리
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Optional, Dict, Any, TYPE_CHECKING, List, Tuple
from datetime import datetime
from enum import Enum
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from collections import Counter
from difflib import SequenceMatcher

if TYPE_CHECKING:
    from fastapi import FastAPI, BackgroundTasks

# Supabase 클라이언트
from config.supabase_client import (
    save_evaluation_to_supabase,
    link_generation_to_evaluation,
    is_supabase_available,
)

logger = logging.getLogger(__name__)

# TruLens 
try:
    from trulens.core import TruSession
    from trulens.core import Metric, Selector
    from trulens.apps.app import TruApp
    import numpy as np
    TRULENS_AVAILABLE = True
except ImportError:
    TRULENS_AVAILABLE = False
    logger.warning("TruLens libraries not available. Falling back to custom evaluation.")

# 중앙 모델 설정 임포트
try:
    try:
        from backend.config.models import MODEL_CONFIG
    except ImportError:
        from config.models import MODEL_CONFIG
except ImportError:
    logger.warning("MODEL_CONFIG import failed. Using fallback mapping.")
    MODEL_CONFIG = {}

# Suppress verbose logging
logging.getLogger("google.generativeai").setLevel(logging.WARNING)
logging.getLogger("google_genai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("trulens.core.utils.evaluator").setLevel(logging.WARNING)
logging.getLogger("trulens.core.database.sqlalchemy").setLevel(logging.WARNING)
logging.getLogger("alembic").setLevel(logging.WARNING)

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
    eval_report: Optional[Dict] = None
    timestamp: str = ""
    # 4단계 평가 상황 추적
    layers_status: Dict[str, Dict] = None
    
    def __post_init__(self):
        if self.layers_status is None:
            self.layers_status = {
                "syntax": {"status": "pending", "progress": 0, "message": ""},
                "stats": {"status": "pending", "progress": 0, "message": ""},
                "rag": {"status": "pending", "progress": 0, "message": ""},
                "quality": {"status": "pending", "progress": 0, "message": ""},
            }

# ============= Evaluation Manager =============

class EvaluationManager:
    """Manage evaluation jobs"""
    
    def __init__(self):
        self.jobs: Dict[str, EvalJob] = {}
        self.lock = Lock()  # 스레드 안전성

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
        """Update job fields (progress, message, status, etc.)"""
        with self.lock:
            if job_id in self.jobs:
                for key, value in kwargs.items():
                    if hasattr(self.jobs[job_id], key):
                        setattr(self.jobs[job_id], key, value)

    def update_layer_status(self, job_id: str, layer: str, status: str, progress: int = 0, message: str = ""):
        """Update specific layer status (thread-safe)"""
        with self.lock:
            if job_id in self.jobs:
                job = self.jobs[job_id]
                if layer in job.layers_status:
                    job.layers_status[layer]["status"] = status
                    job.layers_status[layer]["progress"] = progress
                    job.layers_status[layer]["message"] = message
                    logger.debug(f"[{job_id}] Updated {layer}: {status} ({progress}%)")

# ============= Layer 1: Syntax Validator =============

class SyntaxValidator:
    """QA 데이터 구문 정확성 검증 (Layer 1-A)
    
    From: qa_quality_evaluator.py
    """
    
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


# ============= Layer 1: Dataset Statistics =============

class DatasetStats:
    """QA 데이터셋 통계 분석 (Layer 1-B)
    
    From: qa_quality_evaluator.py
    """

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

# ============= RAG Triad Evaluator =============

class RAGTriadEvaluator:
    """RAG Triad 평가 로직 (TruLens 기반 개선)"""
    
    def __init__(self, evaluator_model: str = "gemini-2.5-flash"):
        """평가 모델 초기화
        
        Args:
            evaluator_model: 평가 모델명 (gemini-2.5-flash, claude-haiku-4-5, gpt-5.1-*)
        """
        self.judge_model = None
        self.evaluator_model = self._get_model_id(evaluator_model)
        self.tru_session = TruSession() if TRULENS_AVAILABLE else None
        self.feedbacks = []  # Attribute 항상 초기화
        
        # TruLens Feedback Functions 설정 (모델 초기화와 별개로 수행 가능하도록)
        if TRULENS_AVAILABLE:
            try:
                self._setup_trulens_metrics()
            except Exception as e:
                logger.warning(f"Failed to setup trulens metrics: {e}")

        try:
            # Determine which provider and initialize appropriate client
            if "gemini" in self.evaluator_model.lower():
                # Google Gemini
                from langchain_google_genai import ChatGoogleGenerativeAI
                api_key = os.getenv("GOOGLE_API_KEY")
                if api_key:
                    self.judge_model = ChatGoogleGenerativeAI(
                        model=self.evaluator_model,
                        google_api_key=api_key,
                        temperature=0
                    )
                    logger.info(f"✓ Judge model initialized (Google): {self.evaluator_model}")
                else:
                    logger.warning("GOOGLE_API_KEY not set for evaluator")
                    
            elif "claude" in self.evaluator_model.lower():
                # Anthropic Claude
                from langchain_anthropic import ChatAnthropic
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if api_key:
                    self.judge_model = ChatAnthropic(
                        model=self.evaluator_model,
                        api_key=api_key,
                        temperature=0
                    )
                    logger.info(f"✓ Judge model initialized (Anthropic): {self.evaluator_model}")
                else:
                    logger.warning("ANTHROPIC_API_KEY not set for evaluator")
                    
            elif "gpt" in self.evaluator_model.lower():
                # OpenAI GPT
                from langchain_openai import ChatOpenAI
                api_key = os.getenv("OPENAI_API_KEY")
                if api_key:
                    self.judge_model = ChatOpenAI(
                        model=self.evaluator_model,
                        api_key=api_key,
                        temperature=0
                    )
                    logger.info(f"✓ Judge model initialized (OpenAI): {self.evaluator_model}")
                else:
                    logger.warning("OPENAI_API_KEY not set for evaluator")
            else:
                logger.warning(f"Unknown evaluator model: {evaluator_model}")
                
        except Exception as e:
            logger.warning(f"Failed to initialize judge model ({self.evaluator_model}): {e}")

    def _get_model_id(self, model_name: str) -> str:
        """약칭에서 실제 API model_id로 변환 (MODEL_CONFIG 기준)"""
        if model_name in MODEL_CONFIG:
            return MODEL_CONFIG[model_name].get("model_id", model_name)
            
        # Fallback mapping (임시)
        fallback_mapping = {
            "claude-haiku": "claude-3-haiku-20240307",
            "claude-sonnet": "claude-3-5-sonnet-20241022",
            "gemini-flash": "gemini-1.5-flash",
            "gemini-pro": "gemini-1.5-pro",
            "gpt-4o": "gpt-4o",
            "gpt-3.5": "gpt-3.5-turbo",
        }
        for short_name, full_id in fallback_mapping.items():
            if short_name in model_name.lower():
                return full_id
        return model_name

    def _setup_trulens_metrics(self):
        """TruLens Metric 객체 생성"""
        self.f_relevance = Metric(
            implementation=self.evaluate_relevance,
            name="Relevance",
            selectors={
                "question": Selector.select_record_input(),
                "answer": Selector.select_record_output(),
            },
        )
        
        self.f_groundedness = Metric(
            implementation=self.evaluate_groundedness,
            name="Groundedness",
            selectors={
                "answer": Selector.select_record_output(),
                "context": Selector.select_context(collect_list=True),
            },
        )
        
        self.f_clarity = Metric(
            implementation=self.evaluate_clarity,
            name="Clarity",
            selectors={
                "question": Selector.select_record_input(),
                "answer": Selector.select_record_output(),
            },
        )
        self.feedbacks = [self.f_relevance, self.f_groundedness, self.f_clarity]

    def _extract_score(self, text: str) -> float:
        """0-10 범위의 점수를 추출하여 0-1로 정규화
        CoT 응답에서 마지막 줄을 우선 파싱"""
        try:
            import re
            lines = text.strip().split('\n')
            # 마지막 줄부터 거꾸로 검색 (CoT 프롬프트는 마지막 줄에 점수를 요청)
            for line in reversed(lines):
                line = line.strip()
                if not line:
                    continue
                # 순수 정수 (0-10)
                match = re.fullmatch(r'([0-9]|10)', line)
                if match:
                    score = int(match.group())
                    return min(10, max(0, score)) / 10.0
                # 줄 안에 0-10 정수 포함
                match = re.search(r'\b(10|[0-9])\b', line)
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


# ============= Helper Functions =============

def clean_markdown(text: str) -> str:
    """컨텍스트에서 마크다운 정크 제거"""
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
        
        return text
    except Exception as e:
        logger.warning(f"Markdown cleaning error: {e}")
        return text


# ============= Layer 3: QA Quality Evaluator =============

class QAQualityEvaluator:
    """QA 품질 평가 (Layer 3) - LLM CoT 기반 (멀티 프로바이더 지원)"""
    
    def __init__(self, model: str = "gpt-5.1"):
        """LLM 기반 평가기 초기화 - OpenAI/Gemini/Anthropic 지원"""
        self.model_display = model
        self.model_id = self._get_model_id(model)
        self.client = None  # legacy OpenAI client (OpenAI 전용)
        self.judge_model = None  # langchain 기반 (Gemini/Anthropic)
        self.provider = self._detect_provider(self.model_id)
        
        try:
            if self.provider == "openai":
                from openai import OpenAI
                api_key = os.getenv("OPENAI_API_KEY")
                if api_key:
                    self.client = OpenAI(api_key=api_key)
                    logger.info(f"✓ QAQualityEvaluator initialized (OpenAI): {self.model_id}")
                else:
                    logger.warning("OPENAI_API_KEY not set for QAQualityEvaluator")

            elif self.provider == "google":
                from langchain_google_genai import ChatGoogleGenerativeAI
                api_key = os.getenv("GOOGLE_API_KEY")
                if api_key:
                    self.judge_model = ChatGoogleGenerativeAI(
                        model=self.model_id,
                        google_api_key=api_key,
                        temperature=0
                    )
                    logger.info(f"✓ QAQualityEvaluator initialized (Google): {self.model_id}")
                else:
                    logger.warning("GOOGLE_API_KEY not set for QAQualityEvaluator")

            elif self.provider == "anthropic":
                from langchain_anthropic import ChatAnthropic
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if api_key:
                    self.judge_model = ChatAnthropic(
                        model=self.model_id,
                        api_key=api_key,
                        temperature=0
                    )
                    logger.info(f"✓ QAQualityEvaluator initialized (Anthropic): {self.model_id}")
                else:
                    logger.warning("ANTHROPIC_API_KEY not set for QAQualityEvaluator")

            else:
                logger.warning(f"Unknown provider for model: {model}")

        except Exception as e:
            logger.warning(f"Failed to initialize QAQualityEvaluator ({self.model_id}): {e}")

    def _get_model_id(self, model_name: str) -> str:
        """MODEL_CONFIG에서 model_id 반환"""
        if model_name in MODEL_CONFIG:
            return MODEL_CONFIG[model_name].get("model_id", model_name)
        return model_name

    def _detect_provider(self, model_id: str) -> str:
        """model_id로 provider 감지"""
        m = model_id.lower()
        if "gemini" in m:
            return "google"
        if "claude" in m:
            return "anthropic"
        return "openai"  # default
    
    def _call_llm(self, prompt: str) -> str:
        """LLM 호출 (간단 응답)"""
        try:
            if self.provider == "openai" and self.client:
                response = self.client.chat.completions.create(
                    model=self.model_id,
                    messages=[
                        {"role": "system", "content": "Respond with ONLY a single digit (0-10). No explanation."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0,
                    max_completion_tokens=100,
                )
                if not response or not response.choices:
                    return "5"
                result = (response.choices[0].message.content or "").strip()
                digits = [c for c in result if c.isdigit()]
                return digits[0] if digits else "5"

            elif self.judge_model:
                response = self.judge_model.invoke(
                    f"Respond with ONLY a single digit (0-10). No explanation.\n\n{prompt}"
                )
                result = (response.content or "").strip()
                digits = [c for c in result if c.isdigit()]
                return digits[0] if digits else "5"

        except Exception as e:
            logger.warning(f"LLM API error: {e}")
        return "5"
    
    def _call_llm_with_reasoning(self, prompt: str) -> str:
        """CoT 방식 LLM 호출"""
        try:
            if self.provider == "openai" and self.client:
                response = self.client.chat.completions.create(
                    model=self.model_id,
                    messages=[
                        {"role": "system", "content": "You are a strict but fair data quality auditor. Think step by step, then provide your score."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0,
                    max_completion_tokens=300,
                )
                if not response or not response.choices:
                    return "Score: 5"
                return (response.choices[0].message.content or "Score: 5").strip()

            elif self.judge_model:
                sys_prompt = "You are a strict but fair data quality auditor. Think step by step, then provide your score."
                response = self.judge_model.invoke(f"{sys_prompt}\n\n{prompt}")
                return (response.content or "Score: 5").strip()

        except Exception as e:
            logger.warning(f"LLM reasoning error: {e}")
        return "Score: 5"
    
    def _parse_cot_score(self, raw: str) -> float:
        """CoT 응답에서 Score 파싱"""
        try:
            matches = re.findall(r'Score:\s*(\d+)', raw, re.IGNORECASE)
            if matches:
                score = int(matches[-1])
                return min(10, max(0, score)) / 10.0
            
            digits = re.findall(r'\b(\d+)\b', raw)
            if digits:
                score = int(digits[-1])
                return min(10, max(0, score)) / 10.0
            
            return 0.5
        except Exception:
            return 0.5

    def evaluate_factuality(self, answer: str, context: str) -> float:
        """사실성 평가 (0-1) - CoT 기반"""
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
        """완전성 평가 (0-1)"""
        prompt = f"""Rate how completely this answer addresses the question.

[QUESTION]
{question}

[ANSWER]
{answer}

[TASK]
Evaluate: Does the answer address the main points of the question?

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
        """근거성 평가 (0-1) - CoT 기반"""
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
Step 2: For each claim, check if it can be derived from the context.
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


# ============= 4-Stage Evaluation Pipeline =============

def run_full_evaluation_pipeline(
    qa_list: List[Dict],
    layers: List[str] = ["syntax", "stats", "rag", "quality"],
    evaluator_model: str = "gemini-2.5-flash",
    eval_manager: Optional[Any] = None,
    job_id: Optional[str] = None,
) -> Dict:
    """
    4단계 평가 파이프라인 (순차 실행) + 진행상황 실시간 업데이트
    
    1️⃣ SyntaxValidator - 구문 검증 ($0)
    2️⃣ DatasetStats - 통계 분석 ($0)
    3️⃣ RAGTriadEvaluator - 기존 평가 (비용有)
    4️⃣ QAQualityEvaluator - CoT 품질 평가 (비용有)
    """
    
    results = {
        "metadata": {
            "total_qa": len(qa_list),
            "evaluator_model": evaluator_model,
            "layers": layers,
            "timestamp": datetime.now().isoformat(),
        },
        "layers": {
            "syntax": None,
            "stats": None,
            "rag": None,
            "quality": None,
        }
    }
    
    valid_qa = qa_list  # Track valid QA from syntax validation
    
    # ========== Layer 1-A: SyntaxValidator ==========
    if "syntax" in layers:
        logger.info(f"[{job_id}] 🔍 Layer 1-A: Syntax Validation starting...")
        
        if eval_manager and job_id:
            eval_manager.update_job(
                job_id,
                message="1️⃣ 구문 검증 중...",
                progress=5
            )
            eval_manager.update_layer_status(job_id, "syntax", "running", 50, "필드, 타입, 길이 검증 중...")
        
        validator = SyntaxValidator()
        valid_qa_filtered = []
        syntax_errors = {}
        
        for i, qa in enumerate(qa_list):
            is_valid, errors = validator.validate_qa(qa)
            if is_valid:
                valid_qa_filtered.append(qa)
            else:
                syntax_errors[i] = errors
        
        valid_qa = valid_qa_filtered
        results["layers"]["syntax"] = {
            "total": len(qa_list),
            "valid": len(valid_qa),
            "invalid": len(qa_list) - len(valid_qa),
            "pass_rate": round(len(valid_qa) / max(len(qa_list), 1) * 100, 2),
            "errors_sample": dict(list(syntax_errors.items())[:5])
        }
        
        if eval_manager and job_id:
            eval_manager.update_job(
                job_id,
                message=f"1️⃣ 구문 검증 완료: {len(valid_qa)}/{len(qa_list)} 통과",
                progress=15
            )
            eval_manager.update_layer_status(job_id, "syntax", "completed", 100, f"✓ {len(valid_qa)}/{len(qa_list)} 통과")
        
        logger.info(f"[{job_id}] ✓ Layer 1-A completed: {len(valid_qa)}/{len(qa_list)} passed")
    
    # ========== Layer 1-B: DatasetStats ==========
    if "stats" in layers:
        logger.info(f"[{job_id}] 📊 Layer 1-B: Dataset Statistics starting...")
        
        if eval_manager and job_id:
            eval_manager.update_job(
                job_id,
                message="2️⃣ 데이터셋 통계 분석 중...",
                progress=30
            )
            job = eval_manager.get_job(job_id)
        stats = DatasetStats(qa_list)
        dataset_stats = stats.analyze_all()
        results["layers"]["stats"] = dataset_stats
        
        if eval_manager and job_id:
            eval_manager.update_job(
                job_id,
                message=f"2️⃣ 데이터셋 분석 완료: 통합점수 {dataset_stats.get('integrated_score', 0)}/10",
                progress=40
            )
            eval_manager.update_layer_status(job_id, "stats", "completed", 100, f"✓ 점수: {dataset_stats.get('integrated_score', 0)}/10")
        
        logger.info(f"[{job_id}] ✓ Layer 1-B completed: integrated_score={dataset_stats.get('integrated_score', 0)}")
    
    # ========== Layer 2: RAGTriadEvaluator ==========
    if "rag" in layers and len(valid_qa) > 0:
        logger.info(f"[{job_id}] 🎯 Layer 2: RAG Triad Evaluation starting...")
        
        if eval_manager and job_id:
            eval_manager.update_job(
                job_id,
                message=f"3️⃣ RAG Triad 평가 진행 중... (0/{len(valid_qa)})",
                progress=45
            )
            eval_manager.update_layer_status(job_id, "rag", "running", 5, f"관련성, 근거성, 명확성 평가 중... (0/{len(valid_qa)})")
        
        rag_evaluator = RAGTriadEvaluator(evaluator_model)
        rag_scores = []
        
        # TruLens 기록을 원할 경우 TruApp을 사용할 수 있지만, 
        # 여기서는 개별 QA 단위로 직접 evaluate 메서드 호출 + 필요시 TruLens 기록 패턴 유지
        
        for i, qa in enumerate(valid_qa):
            try:
                question = qa.get("q", "")
                answer = qa.get("a", "")
                context = qa.get("context", "")
                
                # TruLens를 사용할 수 있는 환경이라면, TruApp 패턴으로 레코딩 시도
                if TRULENS_AVAILABLE:
                    # SimpleRAG와 유사한 임시 클래스 또는 구조로 TruApp 래핑
                    class MockRAG:
                        def __init__(self, q, a, ctx):
                            self.q = q
                            self.a = a
                            self.ctx = ctx
                        def query(self, question):
                            return self.a
                    
                    mock_rag = MockRAG(question, answer, context)
                    tru_rag = TruApp(
                        mock_rag,
                        app_name="AutoEval_RAG_Pipeline",
                        app_version=f"eval_{job_id[:8]}",
                        feedbacks=rag_evaluator.feedbacks
                    )
                    
                    with tru_rag as recording:
                        relevance = rag_evaluator.evaluate_relevance(question, answer)
                        groundedness = rag_evaluator.evaluate_groundedness(answer, context)
                        clarity = rag_evaluator.evaluate_clarity(question, answer)
                else:
                    relevance = rag_evaluator.evaluate_relevance(question, answer)
                    groundedness = rag_evaluator.evaluate_groundedness(answer, context)
                    clarity = rag_evaluator.evaluate_clarity(question, answer)
                
                avg_score = (relevance + groundedness + clarity) / 3
                
                rag_scores.append({
                    "qa_index": i,
                    "relevance": round(relevance, 3),
                    "groundedness": round(groundedness, 3),
                    "clarity": round(clarity, 3),
                    "avg_score": round(avg_score, 3),
                })
                
                # Progress update every 10% or at end
                if eval_manager and job_id and (i % max(1, len(valid_qa) // 10) == 0 or i == len(valid_qa) - 1):
                    progress_pct = int((i + 1) / len(valid_qa) * 100)
                    overall_progress = 45 + int(progress_pct * 0.25)
                    eval_manager.update_job(
                        job_id,
                        message=f"3️⃣ RAG Triad 평가: {i + 1}/{len(valid_qa)}",
                        progress=overall_progress
                    )
                    eval_manager.update_layer_status(job_id, "rag", "running", progress_pct, f"{i + 1}/{len(valid_qa)} 평가 완료")
                        
            except Exception as e:
                logger.warning(f"[{job_id}] RAG evaluation error at index {i}: {e}")
                rag_scores.append({
                    "qa_index": i,
                    "error": str(e),
                    "avg_score": 0.65,
                })
        
        # Calculate summary
        # 에러가 발생한 항목도 avg_score가 0.65(fallback)로 들어있으므로 모두 포함
        results["layers"]["rag"] = {
            "evaluated_count": len(valid_qa),
            "qa_scores": rag_scores,
            "summary": {
                "avg_relevance": round(sum(s.get("relevance", 0.65) for s in rag_scores) / max(len(rag_scores), 1), 3),
                "avg_groundedness": round(sum(s.get("groundedness", 0.65) for s in rag_scores) / max(len(rag_scores), 1), 3),
                "avg_clarity": round(sum(s.get("clarity", 0.65) for s in rag_scores) / max(len(rag_scores), 1), 3),
                "avg_score": round(sum(s.get("avg_score", 0.65) for s in rag_scores) / max(len(rag_scores), 1), 3),
            }
        }
        
        if eval_manager and job_id:
            rag_avg = results["layers"]["rag"]["summary"]["avg_score"]
            eval_manager.update_job(
                job_id,
                message=f"3️⃣ RAG Triad 평가 완료: {rag_avg:.3f}",
                progress=70
            )
            eval_manager.update_layer_status(job_id, "rag", "completed", 100, f"✓ 점수: {rag_avg:.3f}")
        
        logger.info(f"[{job_id}] ✓ Layer 2 completed: {len(valid_qa)} QA evaluated")
    
    # ========== Layer 3: QAQualityEvaluator ==========
    if "quality" in layers and len(valid_qa) > 0:
        logger.info(f"[{job_id}] ⭐ Layer 3: Quality Evaluation starting...")
        
        if eval_manager and job_id:
            eval_manager.update_job(
                job_id,
                message=f"4️⃣ LLM 품질 평가 진행 중... (0/{len(valid_qa)})",
                progress=75
            )
            eval_manager.update_layer_status(job_id, "quality", "running", 5, f"사실성, 완전성, 근거성 CoT 평가 중... (0/{len(valid_qa)})")
        
        quality_evaluator = QAQualityEvaluator(evaluator_model)
        quality_scores = []
        passed = 0
        
        for i, qa in enumerate(valid_qa):
            try:
                factuality = quality_evaluator.evaluate_factuality(qa.get("a", ""), qa.get("context", ""))
                completeness = quality_evaluator.evaluate_completeness(qa.get("q", ""), qa.get("a", ""))
                groundedness = quality_evaluator.evaluate_groundedness(qa.get("a", ""), qa.get("context", ""))
                
                avg_quality = (factuality + completeness + groundedness) / 3
                is_pass = avg_quality >= 0.70
                
                if is_pass:
                    passed += 1
                
                quality_scores.append({
                    "qa_index": i,
                    "factuality": round(factuality, 3),
                    "completeness": round(completeness, 3),
                    "groundedness": round(groundedness, 3),
                    "avg_quality": round(avg_quality, 3),
                    "pass": is_pass,
                })
                
                # Progress update every 10% or at end
                if eval_manager and job_id and (i % max(1, len(valid_qa) // 10) == 0 or i == len(valid_qa) - 1):
                    progress_pct = int((i + 1) / len(valid_qa) * 100)
                    overall_progress = 75 + int(progress_pct * 0.25)
                    eval_manager.update_job(
                        job_id,
                        message=f"4️⃣ LLM 품질 평가: {i + 1}/{len(valid_qa)} (통과: {passed})",
                        progress=overall_progress
                    )
                    eval_manager.update_layer_status(job_id, "quality", "running", progress_pct, f"{i + 1}/{len(valid_qa)} 평가 완료 (통과: {passed})")
                        
            except Exception as e:
                logger.warning(f"[{job_id}] Quality evaluation error at index {i}: {e}")
                quality_scores.append({
                    "qa_index": i,
                    "error": str(e),
                    "avg_quality": 0.65,
                    "pass": False,
                })
        
        # Calculate summary
        valid_quality_scores = [s["avg_quality"] for s in quality_scores if "factuality" in s]
        pass_rate = round(passed / max(len(valid_qa), 1) * 100, 2)
        results["layers"]["quality"] = {
            "evaluated_count": len(valid_qa),
            "pass_count": passed,
            "pass_rate": pass_rate,
            "qa_scores": quality_scores,
            "summary": {
                "avg_factuality": round(sum(s.get("factuality", 0.65) for s in quality_scores) / max(len(quality_scores), 1), 3),
                "avg_completeness": round(sum(s.get("completeness", 0.65) for s in quality_scores) / max(len(quality_scores), 1), 3),
                "avg_groundedness": round(sum(s.get("groundedness", 0.65) for s in quality_scores) / max(len(quality_scores), 1), 3),
                "avg_quality": round(sum(valid_quality_scores) / max(len(valid_quality_scores), 1), 3),
            }
        }
        
        if eval_manager and job_id:
            quality_avg = results["layers"]["quality"]["summary"]["avg_quality"]
            eval_manager.update_job(
                job_id,
                message=f"4️⃣ LLM 품질 평가 완료: {quality_avg:.3f} (통과: {pass_rate}%)",
                progress=85
            )
            eval_manager.update_layer_status(job_id, "quality", "completed", 100, f"✓ 점수: {quality_avg:.3f}, 통과율: {pass_rate}%")
        
        logger.info(f"[{job_id}] ✓ Layer 3 completed: {passed}/{len(valid_qa)} passed ({pass_rate}%)")
    
    # ========== Overall Score ==========
    results["overall_score"] = {
        "status": "completed",
        "valid_qa_count": len(valid_qa),
        "timestamp": datetime.now().isoformat(),
    }
    
    return results

# ============= Background Tasks =============

def run_evaluation(
    job_id: str,
    result_filename: str,
    limit: Optional[int] = None,
    evaluator_model: str = "gemini-2.5-flash",
    eval_manager: Optional[EvaluationManager] = None,
    generation_id: Optional[str] = None
):
    """
    Background task: 4단계 평가 파이프라인
    
    1️⃣ SyntaxValidator - 구문 검증
    2️⃣ DatasetStats - 통계 분석
    3️⃣ RAGTriadEvaluator - 기존 평가
    4️⃣ QAQualityEvaluator - LLM CoT 평가
    """
    import asyncio
    
    if not eval_manager:
        return
    
    try:
        eval_manager.update_job(job_id, status=EvalJobStatus.RUNNING, message="평가 파이프라인 준비 중...")
        
        # 결과 파일 로드
        result_filepath = OUTPUT_DIR / result_filename
        if not result_filepath.exists():
            raise FileNotFoundError(f"Result file not found: {result_filename}")
        
        with open(result_filepath, 'r', encoding='utf-8') as f:
            result_data = json.load(f)
        
        # QA 쌍 + Context 추출
        qa_list = []
        results = result_data.get("results", [])
        
        for result_idx, result in enumerate(results):
            context = result.get("text", "")
            qa_items = result.get("qa_list", [])
            
            for qa_idx, qa in enumerate(qa_items):
                qa_list.append({
                    "q": qa.get("q", ""),
                    "a": qa.get("a", ""),
                    "context": context[:10000],  # 최대 10000자
                    "qa_id": qa.get("qa_id", f"qa_{result_idx}_{qa_idx}"),
                    "intent": qa.get("intent", ""),
                    "docId": qa.get("docId", "")
                })
        
        if limit:
            qa_list = qa_list[:limit]
        
        logger.info(f"[{job_id}] 평가 시작: {len(qa_list)} QA items")
        eval_manager.update_job(job_id, message=f"평가 시작: {len(qa_list)} QA 분석 중...", progress=5)
        
        # ========== 4단계 파이프라인 실행 (진행상황 실시간 업데이트) ==========
        pipeline_results = run_full_evaluation_pipeline(
            qa_list=qa_list,
            layers=["syntax", "stats", "rag", "quality"],
            evaluator_model=evaluator_model,
            eval_manager=eval_manager,
            job_id=job_id
        )
        
        logger.info(f"[{job_id}] 파이프라인 완료")
        
        # ========== 통합 결과 생성 ==========
        syntax_data = pipeline_results["layers"]["syntax"]
        stats_data = pipeline_results["layers"]["stats"]
        rag_data = pipeline_results["layers"]["rag"]
        quality_data = pipeline_results["layers"]["quality"]
        
        # 최종 등급 계산
        valid_qa_count = syntax_data["valid"] if syntax_data else len(qa_list)
        syntax_pass_rate = syntax_data["pass_rate"] if syntax_data else 100
        dataset_quality = stats_data.get("integrated_score", 5) if stats_data else 5
        rag_avg = rag_data["summary"]["avg_score"] if rag_data else 0.65
        quality_avg = quality_data["summary"]["avg_quality"] if quality_data else 0.65
        quality_pass_rate = quality_data["pass_rate"] if quality_data else 0
        
        # 최종 점수 계산 (가중치: 구문 20%, 통계 20%, RAG 30%, 품질 30%)
        final_score = (
            (syntax_pass_rate / 100) * 0.2 +
            (min(dataset_quality, 10) / 10) * 0.2 +
            rag_avg * 0.3 +
            quality_avg * 0.3
        )
        
        # 등급 결정 (A+, A, B+, B, C, F)
        if final_score >= 0.95:
            grade = "A+"
        elif final_score >= 0.85:
            grade = "A"
        elif final_score >= 0.75:
            grade = "B+"
        elif final_score >= 0.65:
            grade = "B"
        elif final_score >= 0.50:
            grade = "C"
        else:
            grade = "F"
        
        # 평가 보고서 생성
        eval_report = {
            "job_id": job_id,
            "result_filename": result_filename,
            "timestamp": datetime.now().isoformat(),
            "metadata": {
                "total_qa": len(qa_list),
                "valid_qa": valid_qa_count,
                "evaluator_model": evaluator_model,
            },
            "pipeline_results": {
                "syntax": syntax_data,
                "stats": stats_data,
                "rag": rag_data,
                "quality": quality_data,
            },
            "summary": {
                "syntax_pass_rate": syntax_pass_rate,
                "dataset_quality_score": round(dataset_quality, 2),
                "rag_average_score": round(rag_avg, 3),
                "quality_average_score": round(quality_avg, 3),
                "quality_pass_rate": quality_pass_rate,
                "final_score": round(final_score, 3),
                "grade": grade,
            },
            "interpretation": {
                "grade_meaning": {
                    "A+": "매우 우수한 QA 품질 (95% 이상)",
                    "A": "우수한 QA 품질 (85% 이상)",
                    "B+": "좋은 QA 품질 (75% 이상)",
                    "B": "그럭저럭 만족할 품질 (65% 이상)",
                    "C": "개선 필요한 품질 (50% 이상)",
                    "F": "재작업 필요 (50% 미만)"
                },
                "recommendations": generate_recommendations(
                    syntax_pass_rate, dataset_quality, rag_avg, quality_avg
                )
            }
        }
        
        # 결과 저장
        VALIDATED_OUTPUT_DIR.mkdir(exist_ok=True)
        report_filename = f"qa_quality_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        report_filepath = VALIDATED_OUTPUT_DIR / report_filename
        
        with open(report_filepath, 'w', encoding='utf-8') as f:
            json.dump(eval_report, f, ensure_ascii=False, indent=2)
        
        logger.info(f"[{job_id}] 평가 완료: {report_filename}")
        
        # ✨ Save to Supabase
        supabase_eval_id = None
        try:
            if is_supabase_available():
                # Prepare scores structure
                scores = {
                    "syntax": {"pass_rate": syntax_data.get("pass_rate", 100.0)},
                    "stats": {
                        "quality_score": stats_data.get("integrated_score", 5.0),
                        "diversity": stats_data.get("diversity", 0.0),
                        "duplication_rate": stats_data.get("duplication_rate", 0.0)
                    },
                    "rag": rag_data.get("summary", {}) if rag_data else {},
                    "quality": quality_data.get("summary", {}) if quality_data else {}
                }
                
                supabase_eval_id = asyncio.run(save_evaluation_to_supabase(
                    job_id=job_id,
                    metadata={
                        "evaluator_model": evaluator_model,
                        "lang": "ko",
                        "prompt_version": "v1"
                    },
                    total_qa=len(qa_list),
                    valid_qa=valid_qa_count,
                    scores=scores,
                    final_score=round(final_score, 3),
                    final_grade=grade,
                    pipeline_results=pipeline_results,
                    interpretation=eval_report.get("interpretation", {})
                ))
                
                if supabase_eval_id:
                    logger.info(f"[{job_id}] ✅ Evaluation Supabase saved: {supabase_eval_id}")
                    
                    # ✨ Link to generation if generation_id provided
                    if generation_id:
                        linked = asyncio.run(link_generation_to_evaluation(generation_id, supabase_eval_id))
                        if linked:
                            logger.info(f"[{job_id}] ✅ Linked to generation: {generation_id}")
                        else:
                            logger.warning(f"[{job_id}] ⚠️ Failed to link generation {generation_id}")
                else:
                    logger.warning(f"[{job_id}] ⚠️ Supabase save returned None")
            else:
                logger.warning(f"[{job_id}] ⚠️ Supabase not available, skipping save")
        except Exception as e:
            logger.error(f"[{job_id}] Error saving to Supabase: {e}")
            # Continue even if Supabase save fails
        
        # Job 상태 업데이트
        eval_manager.update_job(
            job_id,
            status=EvalJobStatus.COMPLETED,
            progress=100,
            message=f"평가 완료! (등급: {grade}, 점수: {final_score:.3f})",
            eval_report=eval_report
        )
        
    except Exception as e:
        logger.error(f"[{job_id}] 평가 실패: {e}", exc_info=True)
        eval_manager.update_job(
            job_id,
            status=EvalJobStatus.FAILED,
            error=str(e),
            message=f"평가 실패: {str(e)}"
        )


def generate_recommendations(syntax_rate: float, stats_score: float, rag_score: float, quality_score: float) -> List[str]:
    """평가 결과에 따른 개선 권고사항 생성"""
    recommendations = []
    
    if syntax_rate < 90:
        recommendations.append("⚠️  구문 오류율이 높습니다. QA 데이터의 필수 필드(q, a, context)를 점검하세요.")
    
    if stats_score < 6:
        recommendations.append("⚠️  데이터 다양성이 낮습니다. 더 많은 intent와 문서 유형을 포함시키세요.")
    
    if rag_score < 0.70:
        recommendations.append("⚠️  RAG 평가 점수가 낮습니다. 답변과 컨텍스트의 관련성을 개선하세요.")
    
    if quality_score < 0.70:
        recommendations.append("⚠️  LLM 품질 평가 점수가 낮습니다. 답변의 사실성, 완전성, 근거성을 개선하세요.")
    
    if syntax_rate >= 95 and stats_score >= 7 and rag_score >= 0.80 and quality_score >= 0.80:
        recommendations.append("✅ 매우 우수한 QA 품질입니다! 현재 데이터로 좋은 성과를 기대할 수 있습니다.")
    
    if not recommendations:
        recommendations.append("✅ 전반적으로 양호한 QA 품질입니다. 지속적인 개선을 진행하세요.")
    
    return recommendations

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
            "generation_id": optional(str, Supabase ID from generation),
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
            generation_id = body.get("generation_id") if isinstance(body, dict) else None
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
            if generation_id:
                logger.info(f"[{job_id}] Linked to generation ID: {generation_id}")
            
            # 백그라운드 태스크로 평가 시작
            background_tasks.add_task(
                run_evaluation,
                job_id=job_id,
                result_filename=result_filename,
                limit=limit,
                evaluator_model=evaluator_model,
                eval_manager=eval_manager,
                generation_id=generation_id
            )
            
            return {
                "success": True,
                "job_id": job_id,
                "message": "Evaluation started",
                "evaluator_model": evaluator_model,
                "generation_id": generation_id,
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
        """Get evaluation job status with 4-layer details"""
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
            "timestamp": job.timestamp,
            "layers": job.layers_status  # 4단계 세부정보
        }
