"""
Backend Configuration Module
최상위 main.py와 동기화된 모델, 프롬프트, 상수 정의
"""

from .models import MODEL_CONFIG, PROMPT_VERSION, INTENT_COLORS
from .prompts import (
    SYSTEM_PROMPT_KO_V1,
    SYSTEM_PROMPT_EN_V1,
    USER_TEMPLATE_KO_V1,
    USER_TEMPLATE_EN_V1,
)
from .constants import OUTPUT_DIR, DATA_FILE

__all__ = [
    "MODEL_CONFIG",
    "PROMPT_VERSION",
    "INTENT_COLORS",
    "SYSTEM_PROMPT_KO_V1",
    "SYSTEM_PROMPT_EN_V1",
    "USER_TEMPLATE_KO_V1",
    "USER_TEMPLATE_EN_V1",
    "OUTPUT_DIR",
    "DATA_FILE",
]
