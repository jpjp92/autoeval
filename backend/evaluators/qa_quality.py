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
        """completeness 단일 지표 평가 — JSON 응답 (score + reason)"""
        sys_msg = """\
<role>
You are a strict but fair data quality auditor evaluating QA pairs.
Evaluate completeness objectively based solely on the provided context.
</role>
<output_format>
Respond ONLY with valid JSON. No explanation, no markdown, no code blocks.
For the reason, write exactly 1 concise sentence in Korean explaining the score.
{"completeness": <int 0-10>, "completeness_reason": "<1 sentence in Korean>"}
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
        """JSON 응답에서 completeness 점수 + reason 파싱 — 실패 시 0.5 fallback"""
        text = re.sub(r"```(?:json)?|```", "", raw).strip()
        try:
            data = json.loads(text)
            def _score(key: str) -> float:
                val = data.get(key, 5)
                return min(10, max(0, int(val))) / 10.0
            return {
                "completeness":        _score("completeness"),
                "completeness_reason": str(data.get("completeness_reason", "")),
            }
        except Exception:
            logger.warning(f"Combined parse failed, raw: {raw[:200]}")
            return {"completeness": 0.5, "completeness_reason": ""}

    def evaluate_all(self, question: str, answer: str, context: str, intent: str = "") -> dict:
        """완전성을 단일 LLM 호출로 평가 (intent 타입 반영)"""
        clean_ctx = clean_markdown(context)
        intent_tag = f"\n<intent_type>{intent}</intent_type>" if intent else ""
        prompt = f"""<context>
{clean_ctx[:3500]}
</context>

<question>{question}</question>
<answer>{answer}</answer>{intent_tag}

<scoring_dimensions>
completeness (0-10): Does the answer fully address the question given its intent type?
   Intent-specific rubrics:
   - list / procedure: 10 = all items/steps enumerated; 5 = partial list; 0 = single sentence
   - boolean: 10 = clear yes/no + brief reason from context; 5 = yes/no only; 0 = hedged non-answer
   - numeric: 10 = exact figure cited with unit; 5 = approximate; 0 = no figure present
   - factoid / definition / how / why / (other): 10 = comprehensive; 6-7 = main point covered; 0-3 = barely addresses
</scoring_dimensions>

<task>
Evaluate the QA pair on completeness. Score 0-10.
Return ONLY valid JSON:
{{"completeness": <0-10>, "completeness_reason": "<1 sentence in Korean>"}}
</task>"""
        try:
            raw = self._call_llm_combined(prompt)
            return self._parse_combined(raw)
        except Exception:
            return {"completeness": 0.5, "completeness_reason": ""}
