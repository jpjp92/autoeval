"""
Syntax Validator
QA 데이터 구문 정확성 검증 (Layer 1-A)
"""
from typing import Dict, List, Tuple


class SyntaxValidator:
    """QA 데이터 구문 정확성 검증 (Layer 1-A)"""

    CONFIG = {
        "q_length": (5, 500),
        "a_length": (2, 2000),
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
