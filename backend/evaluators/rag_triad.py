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
                    logger.info(f"Judge model initialized (Google): {self.evaluator_model}")
                else:
                    logger.warning("GOOGLE_API_KEY not set for evaluator")

            elif "claude" in self.evaluator_model.lower():
                from langchain_anthropic import ChatAnthropic
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if api_key:
                    self.judge_model = ChatAnthropic(
                        model=self.evaluator_model, api_key=api_key, temperature=0
                    )
                    logger.info(f"Judge model initialized (Anthropic): {self.evaluator_model}")
                else:
                    logger.warning("ANTHROPIC_API_KEY not set for evaluator")

            elif "gpt" in self.evaluator_model.lower():
                from langchain_openai import ChatOpenAI
                api_key = os.getenv("OPENAI_API_KEY")
                if api_key:
                    self.judge_model = ChatOpenAI(
                        model=self.evaluator_model, api_key=api_key, temperature=0
                    )
                    logger.info(f"Judge model initialized (OpenAI): {self.evaluator_model}")
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
            ctx_block = f"\n<context>{context[:6000]}</context>\n" if context else ""
            prompt = f"""<role>
You are a strict QA evaluator. Assess how relevant the answer is to the question
based ONLY on the provided context — do NOT use outside knowledge.
</role>

<constraints>
- Score 0-10 (integer only)
- Relevance must be judged against what the CONTEXT establishes, not general domain knowledge
- If the answer addresses the question using information outside the context, reduce the score
- Return ONLY the final integer on the last line
</constraints>
{ctx_block}
<question>{question}</question>
<answer>{answer}</answer>

<task>
Step 1: Identify what the question is asking for (key requirements).
Step 2: Check whether the answer addresses each requirement.
Step 3: Verify that the answer stays within the scope established by the context.
Step 4: Rate relevance:
  - 10: Answer fully addresses the question within context scope
  - 7-9: Mostly relevant, minor gaps or slight scope drift
  - 4-6: Partially relevant or noticeably outside context scope
  - 0-3: Irrelevant or entirely outside context scope
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
- Calculated values (difference, sum, ratio) derived from two numbers that BOTH appear in the context
  are considered FULLY GROUNDED — treat them as Strong evidence, NOT as hallucination.
  e.g., if context has A=71B and B=58B, an answer stating "difference is 13B" is grounded at Strong level.
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
         For calculated values (diff/sum/ratio): verify BOTH source numbers exist in context
Step 3: ASSESS ALIGNMENT per claim:
  - Strong (0.9-1.0): Direct quote, clear paraphrase, OR calculation from two context-present values
  - Medium (0.7-0.8): Multiple elements from context logically combined (ALL source elements must be in context)
  - Weak  (0.5-0.6): Claim is a restatement of context with minor structural change — context must explicitly support it; pure logical inference NOT allowed here
  - None  (0.0):     Not in context, or derived by reasoning beyond what context states
Step 4: DETERMINE GROUNDING LEVEL:
  - 10: All strong / 7-9: Mostly supported / 5-6: Partial / 0-4: Mostly hallucinated
</task>"""
            response = self.judge_model.invoke(prompt)
            return self._extract_score(response.content)
        except Exception as e:
            logger.warning(f"Groundedness evaluation error: {e}")
            return 0.65

    def evaluate_context_relevance(self, question: str, context: str) -> float:
        """맥락성 평가 (0-1) — 컨텍스트가 질문에 답하기에 충분한가 (검색 품질)"""
        if not self.judge_model or not question:
            return 0.7
        try:
            ctx_text = clean_markdown(context)[:8000] if context else ""
            prompt = f"""<role>
You are a strict RAG evaluator. Assess whether the retrieved context contains sufficient
information to answer the question.
</role>

<constraints>
- Score 0-10 (integer only)
- Return ONLY the final integer on the last line, no explanation
</constraints>

<context>{ctx_text}</context>
<question>{question}</question>

<task>
Rate context relevance on a 0-10 scale:
- Does the context contain the SPECIFIC information needed to answer the question?
- Pay special attention to date/period granularity: if the question asks for "January 2023" data
  but the context only has "January 2024" data, treat this as missing information (score 0-3).
  Data with the same field name but a different year/quarter/month is NOT the same data.
- 10: Context directly and completely contains all required information
- 7-9: Context mostly contains the needed information, minor gaps
- 4-6: Context is related but missing key specifics to fully answer
- 0-3: Context does not contain the required information (including wrong date/period)
</task>"""
            response = self.judge_model.invoke(prompt)
            return self._extract_score(response.content)
        except Exception as e:
            logger.warning(f"Context relevance evaluation error: {e}")
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
                "relevance":                _score("relevance"),
                "relevance_reason":         str(data.get("relevance_reason", "")),
                "groundedness":             _score("groundedness"),
                "groundedness_reason":      str(data.get("groundedness_reason", "")),
                "context_relevance":        _score("context_relevance"),
                "context_relevance_reason": str(data.get("context_relevance_reason", "")),
            }
        except Exception:
            logger.warning(f"RAG JSON parse failed, raw: {raw[:200]}")
            return {
                "relevance": 0.65, "relevance_reason": "",
                "groundedness": 0.65, "groundedness_reason": "",
                "context_relevance": 0.65, "context_relevance_reason": "",
            }

    def evaluate_all_with_reasons(self, question: str, answer: str, context: str) -> dict:
        """RAG Triad 3개 차원을 단일 LLM 호출로 평가 + reason 반환"""
        if not self.judge_model:
            return {
                "relevance": 0.65, "relevance_reason": "",
                "groundedness": 0.65, "groundedness_reason": "",
                "context_relevance": 0.65, "context_relevance_reason": "",
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
1. relevance (0-10): Does the answer FULLY and COMPLETELY address ALL aspects of the question?
   - 10: All aspects of the question are answered; no missing items, no unrequested claims
   - 8-9: Mostly complete; one minor aspect missing or slight scope drift
   - 6-7: Core intent addressed but at least one meaningful aspect of the question is missing
   - 4-5: Answers only part of what was asked; multiple aspects omitted
   - 0-3: Off-topic, ignores the question, or answers a fundamentally different question
   Note: a partial answer (covers 1 of N items the question asks about) must score ≤ 6.

2. groundedness (0-10): Are ALL claims in the answer grounded in the context?
   Reasoning steps (do internally before writing the score and reason):
   a. Extract each atomic claim from the answer
   b. For each claim, apply the following grounding rules in order:

   RULE 1 — Direct support:
     supported=true IF: direct quote OR unambiguous paraphrase (same meaning, different words)

   RULE 2 — Derived calculations (EXCEPTION — treat as supported=true, Strong level):
     If the answer states a calculated value (difference, sum, ratio, multiple, percentage change)
     AND both source numbers exist explicitly in the context, the claim is FULLY GROUNDED.
     e.g., context has "2001년 109백만달러" and "2023년 952백만달러"
     → answer stating "약 8.7배 증가" is grounded (Strong).
     e.g., context has "67개국" and "129개국"
     → answer stating "절반이 넘는 국가" is grounded (Strong).

   RULE 3 — Trend expressions (EXCEPTION — treat as supported=true, Medium level):
     If the answer uses trend language (e.g., "연속 감소세", "반등", "꾸준한 상승")
     AND ALL underlying numbers that support this direction are explicitly in the context,
     the claim is grounded at Medium level.
     Condition: factual direction only — NO subjective labels allowed
     ("상당히", "핵심 시장", "인상적", "성공적" etc. are NOT grounded unless explicitly in context).

   RULE 4 — Not grounded:
     supported=false IF: requires interpretation, deduction beyond numbers, or is not in context.

   c. score = round(supported_count / total_claims * 10)
   - 10: All claims directly traceable to context (Strong)
   - 7-9: Mostly Strong/Medium, at most one minor unsupported claim
   - 5-6: Half supported / half unsupported
   - 0-4: Mostly unsupported, hallucinated, or added from outside context
   For groundedness_reason: write 1 concise Korean prose sentence that synthesizes the claim
   verification results and naturally includes a direct context quote for the key claim.
   Do NOT use bullet points or lists in the reason.

3. context_relevance (0-10): Does the retrieved context contain sufficient information to answer the question?
   — This measures RETRIEVAL quality, not the answer itself.
   - 10: Context directly and completely contains all facts needed to answer
   - 7-9: Context mostly sufficient; one minor gap
   - 4-6: Context is topically related but missing key specifics; LLM must infer or hallucinate to answer
   - 0-3: Context does not contain the information needed; question cannot be answered from this context alone
   For context_relevance_reason: 1 concise Korean sentence explaining what the context does or does not provide.
</scoring_dimensions>

<task>
For groundedness, reason through claims step by step internally, then write the synthesized reason.
For relevance and context_relevance, write exactly 1 concise sentence in Korean explaining the score.
Return ONLY valid JSON:
{{"relevance": <0-10>, "relevance_reason": "<1 sentence in Korean>", "groundedness": <0-10>, "groundedness_reason": "<1 concise Korean prose sentence with context quote, no bullets>", "context_relevance": <0-10>, "context_relevance_reason": "<1 sentence in Korean>"}}
</task>"""
            response = self.judge_model.invoke(prompt)
            return self._parse_rag_json(response.content or "")
        except Exception as e:
            logger.warning(f"RAG evaluate_all_with_reasons error: {e}")
            return {
                "relevance": 0.65, "relevance_reason": "",
                "groundedness": 0.65, "groundedness_reason": "",
                "context_relevance": 0.65, "context_relevance_reason": "",
            }
