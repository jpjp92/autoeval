"""
QA Quality Evaluator
LLM CoT 기반 품질 평가 (Layer 3)
멀티 프로바이더 지원: OpenAI / Google Gemini / Anthropic Claude
"""
import json
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
                    logger.info(f"QAQualityEvaluator initialized (OpenAI): {self.model_id}")
                else:
                    logger.warning("OPENAI_API_KEY not set for QAQualityEvaluator")

            elif self.provider == "google":
                from langchain_google_genai import ChatGoogleGenerativeAI
                api_key = os.getenv("GOOGLE_API_KEY")
                if api_key:
                    self.judge_model = ChatGoogleGenerativeAI(
                        model=self.model_id, google_api_key=api_key, temperature=0,
                        timeout=90,
                    )
                    logger.info(f"QAQualityEvaluator initialized (Google): {self.model_id}")
                else:
                    logger.warning("GOOGLE_API_KEY not set for QAQualityEvaluator")

            elif self.provider == "anthropic":
                from langchain_anthropic import ChatAnthropic
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if api_key:
                    self.judge_model = ChatAnthropic(
                        model=self.model_id, api_key=api_key, temperature=0
                    )
                    logger.info(f"QAQualityEvaluator initialized (Anthropic): {self.model_id}")
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

    def _call_llm_combined(self, prompt: str) -> str:
        """completeness 단일 지표 평가 — JSON 응답 (score + coverage + missing + reason)"""
        sys_msg = """\
<role>
You are a strict QA completeness evaluator.
Your job is to detect missing parts of an answer, not to reward verbosity.
</role>

<rules>
- Completeness = how fully the answer covers ALL parts of the question.
- First decompose the question into atomic sub-questions.
- Then check whether each sub-question is answered.
- Do NOT reward longer answers; focus on coverage of requirements.
- If any key part is missing, the score must be reduced significantly.
- Evaluate completeness with respect to the QUESTION.
- Use context only to verify factual support for the claims.
</rules>

<output_format>
Return ONLY valid JSON:
{
  "completeness": <0-10>,
  "coverage": <0.0-1.0>,
  "missing_aspects": ["..."],
  "completeness_reason": "<1 concise sentence in Korean explaining the score, including missing parts if any>"
}
</output_format>"""
        try:
            if self.provider == "openai" and self.client:
                response = self.client.chat.completions.create(
                    model=self.model_id,
                    messages=[
                        {"role": "system", "content": sys_msg},
                        {"role": "user",   "content": prompt},
                    ],
                    temperature=0,
                    max_completion_tokens=600,
                )
                if not response or not response.choices:
                    return "{}"
                return (response.choices[0].message.content or "{}").strip()

            elif self.judge_model:
                # Claude / Gemini: SystemMessage/HumanMessage 분리 (권장 방식)
                from langchain_core.messages import SystemMessage, HumanMessage
                response = self.judge_model.invoke([
                    SystemMessage(content=sys_msg),
                    HumanMessage(content=prompt),
                ])
                return (response.content or "{}").strip()

        except Exception as e:
            logger.warning(f"LLM combined eval error: {e}")
        return "{}"

    def _parse_combined(self, raw: str) -> dict:
        """JSON 응답 파싱 — completeness, coverage, missing_aspects 추출"""
        text = re.sub(r"```(?:json)?|```", "", raw).strip()
        try:
            data = json.loads(text)
            def _score(key: str, default: int = 5) -> float:
                val = data.get(key, default)
                return min(10, max(0, float(val))) / 10.0

            return {
                "completeness":        _score("completeness"),
                "coverage":            float(data.get("coverage", 0.5)),
                "missing_aspects":     list(data.get("missing_aspects", [])),
                "completeness_reason": str(data.get("completeness_reason", "")),
            }
        except Exception:
            logger.warning(f"Combined parse failed, raw: {raw[:200]}")
            return {
                "completeness": 0.5,
                "coverage": 0.5,
                "missing_aspects": [],
                "completeness_reason": ""
            }

    def evaluate_all(self, question: str, answer: str, context: str, intent: str = "") -> dict:
        """완전성을 단일 LLM 호출로 평가 (질문 분해 및 커버리지 계산)"""
        clean_ctx = clean_markdown(context)
        intent_tag = f"\n<intent_type>{intent}</intent_type>" if intent else ""
        prompt = f"""<context>
{clean_ctx[:7000]}
</context>

<question>{question}</question>
<answer>{answer}</answer>{intent_tag}

<scoring_guidelines>
- 10: All sub-questions fully answered; no missing parts.
- 7-9: Most answered, minor omissions that don't affect core intent.
- 4-6: Major parts missing; core intent only partially addressed.
- 0-3: Largely incomplete; fails to address the main question.

Note: Completeness score should be heavily influenced by the coverage of sub-questions.
Recommended logic: Final Score = 0.7 * (Coverage * 10) + 0.3 * (Quality/Clarity Score)
</scoring_guidelines>

<task>
1. Break the question into atomic sub-questions.
2. For each sub-question, check BOTH:
   a. Is it addressed in the answer?
   b. Is the answer's claim supported by the context? (Claims outside the context do NOT count as answered)
3. Identify any missing aspects or unaddressed requirements.
4. Calculate coverage (ratio of sub-questions answered WITH context support).
5. Determine the final completeness score (0-10).

Return ONLY valid JSON:
{{
  "completeness": <0-10>,
  "coverage": <0.0-1.0>,
  "missing_aspects": ["..."],
  "completeness_reason": "<1 concise sentence in Korean explaining the score, mentioning what was missing>"
}}
</task>"""
        try:
            raw = self._call_llm_combined(prompt)
            return self._parse_combined(raw)
        except Exception:
            return {
                "completeness": 0.5,
                "coverage": 0.5,
                "missing_aspects": [],
                "completeness_reason": ""
            }
