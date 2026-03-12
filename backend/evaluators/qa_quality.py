"""
QA Quality Evaluator
LLM CoT 기반 품질 평가 (Layer 3)
멀티 프로바이더 지원: OpenAI / Google Gemini / Anthropic Claude
"""
import logging
import os
import re

logger = logging.getLogger(__name__)

# 중앙 모델 설정
try:
    from backend.config.models import MODEL_CONFIG
except ImportError:
    try:
        from config.models import MODEL_CONFIG
    except ImportError:
        MODEL_CONFIG = {}

# rag_triad의 clean_markdown 재사용
try:
    from evaluators.rag_triad import clean_markdown
except ImportError:
    try:
        from .rag_triad import clean_markdown
    except ImportError:
        def clean_markdown(text):
            return text


class QAQualityEvaluator:
    """QA 품질 평가 (Layer 3) - LLM CoT 기반, 멀티 프로바이더"""

    def __init__(self, model: str = "gpt-5.1"):
        self.model_display = model
        self.model_id = self._get_model_id(model)
        self.client = None       # OpenAI native client
        self.judge_model = None  # langchain (Gemini / Anthropic)
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
                        model=self.model_id, google_api_key=api_key, temperature=0
                    )
                    logger.info(f"✓ QAQualityEvaluator initialized (Google): {self.model_id}")
                else:
                    logger.warning("GOOGLE_API_KEY not set for QAQualityEvaluator")

            elif self.provider == "anthropic":
                from langchain_anthropic import ChatAnthropic
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if api_key:
                    self.judge_model = ChatAnthropic(
                        model=self.model_id, api_key=api_key, temperature=0
                    )
                    logger.info(f"✓ QAQualityEvaluator initialized (Anthropic): {self.model_id}")
                else:
                    logger.warning("ANTHROPIC_API_KEY not set for QAQualityEvaluator")

            else:
                logger.warning(f"Unknown provider for model: {model}")

        except Exception as e:
            logger.warning(f"Failed to initialize QAQualityEvaluator ({self.model_id}): {e}")

    def _get_model_id(self, model_name: str) -> str:
        if model_name in MODEL_CONFIG:
            return MODEL_CONFIG[model_name].get("model_id", model_name)
        return model_name

    def _detect_provider(self, model_id: str) -> str:
        m = model_id.lower()
        if "gemini" in m:
            return "google"
        if "claude" in m:
            return "anthropic"
        return "openai"

    def _call_llm(self, prompt: str) -> str:
        """단순 응답 LLM 호출"""
        try:
            if self.provider == "openai" and self.client:
                response = self.client.chat.completions.create(
                    model=self.model_id,
                    messages=[
                        {"role": "system", "content": "Respond with ONLY a single digit (0-10). No explanation."},
                        {"role": "user",   "content": prompt}
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
                        {"role": "user",   "content": prompt}
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
                return min(10, max(0, int(matches[-1]))) / 10.0
            digits = re.findall(r'\b(\d+)\b', raw)
            if digits:
                return min(10, max(0, int(digits[-1]))) / 10.0
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
            return self._parse_cot_score(self._call_llm_with_reasoning(prompt))
        except Exception:
            return 0.5

    def evaluate_completeness(self, question: str, answer: str) -> float:
        """완전성 평가 (0-1)"""
        prompt = f"""Rate how completely this answer addresses the question.

[QUESTION]
{question}

[ANSWER]
{answer}

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
            return min(10, max(0, int(self._call_llm(prompt).strip()))) / 10.0
        except ValueError:
            return 0.5

    def evaluate_groundedness(self, answer: str, context: str) -> float:
        """근거성 평가 (0-1) - CoT 기반"""
        clean_ctx = clean_markdown(context)
        prompt = f"""You are a strict data quality auditor evaluating GROUNDEDNESS.

CRITICAL RULES:
- Do NOT require exact quotes or identical wording.
- If the answer's meaning can be DERIVED or INFERRED from the context, it is grounded.
- Only penalize if the answer asserts something the context does NOT support at all.

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
            return self._parse_cot_score(self._call_llm_with_reasoning(prompt))
        except Exception:
            return 0.5
