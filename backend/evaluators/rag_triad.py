"""
RAG Triad Evaluator
RAG Triad 평가 로직 + clean_markdown helper (Layer 2)
멀티 프로바이더 지원 (OpenAI / Gemini / Anthropic) — LangChain judge 직접 호출
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


def clean_markdown(text: str) -> str:
    """컨텍스트에서 마크다운 정크 제거"""
    if not text or not isinstance(text, str):
        return text
    try:
        text = re.sub(r'\*[닫열변삭기시구기터이][^*]*\*', '', text)
        text = re.sub(r'^\|[-\s|]+\|$', '', text, flags=re.MULTILINE)
        text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
        text = text.replace('\\\\n', '\n').replace('\\n', '\n')
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        return '\n'.join(lines)
    except Exception as e:
        logger.warning(f"Markdown cleaning error: {e}")
        return text


class RAGTriadEvaluator:
    """RAG Triad 평가 로직 (Layer 2) — LangChain judge 직접 호출"""

    def __init__(self, evaluator_model: str = "gemini-2.5-flash"):
        self.judge_model = None
        self.evaluator_model = self._get_model_id(evaluator_model)

        try:
            if "gemini" in self.evaluator_model.lower():
                from langchain_google_genai import ChatGoogleGenerativeAI
                api_key = os.getenv("GOOGLE_API_KEY")
                if api_key:
                    self.judge_model = ChatGoogleGenerativeAI(
                        model=self.evaluator_model, google_api_key=api_key, temperature=0,
                        timeout=90,
                    )
                    logger.info(f"✓ Judge model initialized (Google): {self.evaluator_model}")
                else:
                    logger.warning("GOOGLE_API_KEY not set for evaluator")

            elif "claude" in self.evaluator_model.lower():
                from langchain_anthropic import ChatAnthropic
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if api_key:
                    self.judge_model = ChatAnthropic(
                        model=self.evaluator_model, api_key=api_key, temperature=0
                    )
                    logger.info(f"✓ Judge model initialized (Anthropic): {self.evaluator_model}")
                else:
                    logger.warning("ANTHROPIC_API_KEY not set for evaluator")

            elif "gpt" in self.evaluator_model.lower():
                from langchain_openai import ChatOpenAI
                api_key = os.getenv("OPENAI_API_KEY")
                if api_key:
                    self.judge_model = ChatOpenAI(
                        model=self.evaluator_model, api_key=api_key, temperature=0
                    )
                    logger.info(f"✓ Judge model initialized (OpenAI): {self.evaluator_model}")
                else:
                    logger.warning("OPENAI_API_KEY not set for evaluator")
            else:
                logger.warning(f"Unknown evaluator model: {self.evaluator_model}")

        except Exception as e:
            logger.warning(f"Failed to initialize judge model ({self.evaluator_model}): {e}")

    def _get_model_id(self, model_name: str) -> str:
        """MODEL_CONFIG 기준 model_id 변환"""
        if model_name in MODEL_CONFIG:
            return MODEL_CONFIG[model_name].get("model_id", model_name)
        fallback = {
            "claude-haiku":  "claude-3-haiku-20240307",
            "claude-sonnet": "claude-3-5-sonnet-20241022",
            "gemini-flash":  "gemini-1.5-flash",
            "gemini-pro":    "gemini-1.5-pro",
            "gpt-4o":        "gpt-4o",
            "gpt-3.5":       "gpt-3.5-turbo",
        }
        for short, full in fallback.items():
            if short in model_name.lower():
                return full
        return model_name

    def _extract_score(self, text: str) -> float:
        """0-10 점수 추출 → 0-1 정규화 (CoT 마지막 줄 우선)"""
        try:
            lines = text.strip().split('\n')
            for line in reversed(lines):
                line = line.strip()
                if not line:
                    continue
                match = re.fullmatch(r'([0-9]|10)', line)
                if match:
                    return min(10, max(0, int(match.group()))) / 10.0
                match = re.search(r'\b(10|[0-9])\b', line)
                if match:
                    return min(10, max(0, int(match.group()))) / 10.0
            return 0.5
        except Exception as e:
            logger.warning(f"Score extraction error: {e}")
            return 0.5

    def evaluate_relevance(self, question: str, answer: str, context: str = "") -> float:
        """질문과 답변의 관련성 평가 (0-1) — 도메인 컨텍스트 반영"""
        if not self.judge_model or not question or not answer:
            return 0.7
        try:
            ctx_block = f"\n<context_excerpt>{context[:2000]}</context_excerpt>\n" if context else ""
            prompt = f"""<role>
You are a strict QA evaluator. Assess how relevant the answer is to the question
in the context of the provided domain material.
</role>

<constraints>
- Score 0-10 (integer only)
- Return ONLY the final integer on the last line, no explanation
</constraints>
{ctx_block}
<question>{question}</question>
<answer>{answer}</answer>

<task>
Rate relevance considering:
- Does the answer address what the question is asking?
- Is the answer relevant within the domain established by the context?
0 = completely irrelevant, 10 = perfectly relevant to both question and domain.
</task>"""
            response = self.judge_model.invoke(prompt)
            return self._extract_score(response.content)
        except Exception as e:
            logger.warning(f"Relevance evaluation error: {e}")
            return 0.65

    def evaluate_groundedness(self, answer: str, context: str) -> float:
        """답변의 근거성 평가 (0-1) - CoT"""
        if not self.judge_model or not answer:
            return 0.7
        try:
            context_text = context[:10000] if context else "일반적인 배경 지식"
            prompt = f"""<role>
You are an expert at assessing whether an answer is grounded in the provided context.
Use Chain of Thought reasoning to evaluate systematically.
</role>

<constraints>
- Use FLEXIBLE MATCHING (NOT exact string matching) when finding evidence
- Return ONLY the final integer score (0-10) on the last line
</constraints>

<context>
{context_text}
</context>

<answer>
{answer}
</answer>

<task>
Step 1: IDENTIFY KEY CLAIMS — list the main factual claims in the answer
Step 2: FIND SUPPORTING EVIDENCE — search context per claim using flexible matching
Step 3: ASSESS ALIGNMENT per claim:
  - Strong (0.9-1.0): Direct quote or clear paraphrase
  - Medium (0.7-0.8): Multiple elements logically combined
  - Weak  (0.5-0.6): Inference supported by context
  - None  (0.0):     Not in context
Step 4: DETERMINE GROUNDING LEVEL:
  - 10: All strong / 7-9: Mostly supported / 5-6: Partial / 0-4: Mostly hallucinated
</task>"""
            response = self.judge_model.invoke(prompt)
            return self._extract_score(response.content)
        except Exception as e:
            logger.warning(f"Groundedness evaluation error: {e}")
            return 0.65

    def evaluate_clarity(self, question: str, answer: str) -> float:
        """답변의 명확성 평가 (0-1)"""
        if not self.judge_model or not answer:
            return 0.7
        try:
            prompt = f"""<role>
You are a strict QA evaluator assessing question-answer pair clarity and comprehensibility.
</role>

<constraints>
- Score 0-10 (integer only)
- Return ONLY the final integer on the last line, no explanation
</constraints>

<question>{question}</question>
<answer>{answer}</answer>

<task>
Rate clarity on a 0-10 scale:
- Is the question well-formed and understandable?
- Is the answer clearly written without ambiguities?
- Is the answer properly structured?
</task>"""
            response = self.judge_model.invoke(prompt)
            return self._extract_score(response.content)
        except Exception as e:
            logger.warning(f"Clarity evaluation error: {e}")
            return 0.65

    def _parse_rag_json(self, raw: str) -> dict:
        """RAG Triad JSON 응답 파싱 — 실패 시 fallback 0.65"""
        text = re.sub(r"```(?:json)?|```", "", raw).strip()
        try:
            data = json.loads(text)
            def _score(key: str) -> float:
                val = data.get(key, 6)
                return min(10, max(0, int(val))) / 10.0
            return {
                "relevance":           _score("relevance"),
                "relevance_reason":    str(data.get("relevance_reason", "")),
                "groundedness":        _score("groundedness"),
                "groundedness_reason": str(data.get("groundedness_reason", "")),
                "clarity":             _score("clarity"),
                "clarity_reason":      str(data.get("clarity_reason", "")),
            }
        except Exception:
            logger.warning(f"RAG JSON parse failed, raw: {raw[:200]}")
            return {
                "relevance": 0.65, "relevance_reason": "",
                "groundedness": 0.65, "groundedness_reason": "",
                "clarity": 0.65, "clarity_reason": "",
            }

    def evaluate_all_with_reasons(self, question: str, answer: str, context: str) -> dict:
        """RAG Triad 3개 차원을 단일 LLM 호출로 평가 + reason 반환"""
        if not self.judge_model:
            return {
                "relevance": 0.65, "relevance_reason": "",
                "groundedness": 0.65, "groundedness_reason": "",
                "clarity": 0.65, "clarity_reason": "",
            }
        try:
            import json as _json
            ctx = clean_markdown(context)[:8000] if context else ""
            prompt = f"""<role>
You are a strict QA data quality auditor. Evaluate the QA pair on three RAG Triad dimensions
based solely on the provided context.
</role>

<context>
{ctx}
</context>

<question>{question}</question>
<answer>{answer}</answer>

<scoring_dimensions>
1. relevance (0-10): Does the answer directly address what the question asks, within the domain?
   - 10: Perfectly on-point / 6-7: Mostly relevant, minor drift / 0-3: Off-topic or ignores question

2. groundedness (0-10): Are all answer claims supported by the context? (use flexible matching)
   - 10: All claims traceable to context / 7-9: Mostly supported / 5-6: Partial / 0-4: Hallucinated

3. clarity (0-10): Is the Q-A pair well-formed and unambiguous?
   - 10: Question precise + answer clearly structured / 5-6: Somewhat vague / 0-3: Confusing or ambiguous
</scoring_dimensions>

<task>
Evaluate all three dimensions. For each reason, write exactly 1 concise sentence in Korean explaining the score.
Return ONLY valid JSON:
{{"relevance": <0-10>, "relevance_reason": "<1 sentence in Korean>", "groundedness": <0-10>, "groundedness_reason": "<1 sentence in Korean>", "clarity": <0-10>, "clarity_reason": "<1 sentence in Korean>"}}
</task>"""
            response = self.judge_model.invoke(prompt)
            return self._parse_rag_json(response.content or "")
        except Exception as e:
            logger.warning(f"RAG evaluate_all_with_reasons error: {e}")
            return {
                "relevance": 0.65, "relevance_reason": "",
                "groundedness": 0.65, "groundedness_reason": "",
                "clarity": 0.65, "clarity_reason": "",
            }
