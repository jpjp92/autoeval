"""
Dataset Statistics
QA 데이터셋 통계 분석 (Layer 1-B)
"""
from collections import Counter
from difflib import SequenceMatcher
from typing import Dict, List


class DatasetStats:
    """QA 데이터셋 통계 분석 (Layer 1-B)"""

    def __init__(self, qa_list: List[Dict]):
        self.qa_list = qa_list
        self.results = {}

    def analyze_all(self) -> Dict:
        """모든 통계 지표 계산"""
        self.results = {
            "diversity":        self._analyze_diversity(),
            "duplication_rate": self._analyze_duplication_rate(),
            "skewness":         self._analyze_skewness(),
            "data_sufficiency": self._analyze_data_sufficiency(),
        }
        self.results["integrated_score"] = self._calculate_integrated_score()
        return self.results

    def _analyze_diversity(self) -> Dict:
        """다양성 (0-10) - intent 커버리지 + 어휘 다양도 + intent 균형도 통합"""
        intent_dist = Counter([qa.get("intent", "unknown") for qa in self.qa_list])
        doc_dist    = Counter([qa.get("docId",  "unknown") for qa in self.qa_list])
        total = max(len(self.qa_list), 1)

        intent_coverage = len(intent_dist) / total
        doc_coverage    = len(doc_dist)    / total

        all_q_words = [w for qa in self.qa_list for w in qa.get("q", "").split()]
        vocabulary_diversity = len(set(all_q_words)) / max(len(all_q_words), 1)

        intent_values = list(intent_dist.values())
        intent_balance = (
            min(intent_values) / max(intent_values)
            if intent_values and max(intent_values) > 0 else 0
        )

        score = (intent_coverage + doc_coverage + vocabulary_diversity + intent_balance) / 4 * 10

        q_lengths = [len(qa.get("q", "")) for qa in self.qa_list]
        a_lengths = [len(qa.get("a", "")) for qa in self.qa_list]
        q_avg = sum(q_lengths) / len(q_lengths) if q_lengths else 0
        a_avg = sum(a_lengths) / len(a_lengths) if a_lengths else 0
        q_std = (sum((x - q_avg) ** 2 for x in q_lengths) / len(q_lengths)) ** 0.5 if q_lengths else 0
        a_std = (sum((x - a_avg) ** 2 for x in a_lengths) / len(a_lengths)) ** 0.5 if a_lengths else 0

        return {
            "score":             round(min(10, score), 2),
            "intent_type_count": len(intent_dist),
            "doc_count":         len(doc_dist),
            "vocabulary_diversity": round(vocabulary_diversity, 3),
            "intent_balance":    round(intent_balance, 3),
            "intent_distribution": dict(intent_dist),
            "question_length":   {"avg": round(q_avg, 2), "std": round(q_std, 2)},
            "answer_length":     {"avg": round(a_avg, 2), "std": round(a_std, 2)},
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
            "score":            round(min(10, max(0, (100 - near_dup_rate) / 10)), 2),
            "duplicate_count":  len(duplicates),
            "near_duplicate_rate": round(near_dup_rate, 2),
        }

    def _analyze_skewness(self) -> Dict:
        """편중도 (0-10) - 특정 docId 집중도"""
        doc_dist    = Counter([qa.get("docId",  "unknown") for qa in self.qa_list])
        intent_dist = Counter([qa.get("intent", "unknown") for qa in self.qa_list])
        doc_max_ratio = max(doc_dist.values()) / sum(doc_dist.values()) * 100 if doc_dist else 0

        if doc_max_ratio <= 50:
            score = 10
        elif doc_max_ratio <= 70:
            score = 7
        else:
            score = max(0, 10 - (doc_max_ratio - 70) / 10)

        return {
            "score":           round(min(10, score), 2),
            "doc_max_ratio":   round(doc_max_ratio, 2),
            "doc_distribution": dict(doc_dist),
            "intent_max_ratio": round(
                max(intent_dist.values()) / sum(intent_dist.values()) * 100
                if intent_dist else 0, 2
            ),
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
        return round(
            self.results["diversity"]["score"]        * 0.30
            + self.results["duplication_rate"]["score"] * 0.25
            + self.results["skewness"]["score"]         * 0.35
            + self.results["data_sufficiency"]["score"] * 0.10,
            2
        )
