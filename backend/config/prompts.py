"""
config/prompts.py — 호환성 shim
실제 구현은 generators/prompts.py 로 이동되었습니다.
이 파일은 하위 호환성을 위해 re-export합니다.
"""
from generators.prompts import (  # noqa: F401
    SYSTEM_PROMPT_KO_V1,
    SYSTEM_PROMPT_EN_V1,
    USER_TEMPLATE_KO_V1,
    USER_TEMPLATE_EN_V1,
    build_system_prompt,
    build_user_template,
)
