import math
from collections import Counter
from difflib import SequenceMatcher
from typing import Dict, List


class DatasetStats:
    """QA 데이터셋 통계 분석 (Layer 1-B)"""

    def __init__(self, qa_list: List[Dict]):
        self.qa_list = qa_list
        self.results = {"stats": {}, "metrics": {}}

    def analyze_all(self) -> Dict:
        """모든 통계 및 지표 계산"""
        diversity_data = self._analyze_diversity()
        duplication_data = self._analyze_duplication()
        skewness_data = self._analyze_skewness()
        completeness_data = self._analyze_sufficiency()

        # 1. 원시 통계 (Stats)
        self.results["stats"] = {
            "diversity":    diversity_data["stats"],
            "duplication":  duplication_data["stats"],
            "skewness":     skewness_data["stats"],
            "sufficiency":  completeness_data["stats"],
        }
        
        # 2. 파생 지표 (Metrics - Score 0-10)
        self.results["metrics"] = {
            "diversity_score":    diversity_data["score"],
            "duplication_score":  duplication_data["score"],
            "skewness_score":     skewness_data["score"],
            "sufficiency_score":  completeness_data["score"],
        }

        # 프론트엔드 하위 호환성을 위해 최상위 레벨에도 기존 키 유지 (정리 후 제거 예정)
        self.results["diversity"]        = {**diversity_data["stats"], "score": diversity_data["score"]}
        self.results["duplication_rate"] = {**duplication_data["stats"], "score": duplication_data["score"]}
        self.results["skewness"]         = {**skewness_data["stats"], "score": skewness_data["score"]}
        self.results["data_sufficiency"] = {**completeness_data["stats"], "score": completeness_data["score"]}
        
        return self.results

    def _calculate_entropy(self, distribution: Dict[str, int]) -> float:
        """Shannon Entropy 계산 (분포의 균형도 측정)"""
        total = sum(distribution.values())
        if total == 0:
            return 0.0
        entropy = 0.0
        for count in distribution.values():
            p = count / total
            if p > 0:
                entropy -= p * math.log2(p)
        return round(entropy, 3)

    def _analyze_diversity(self) -> Dict:
        """다양성 분석 - 인텐트 분포, 엔트로피, 어휘 다양도(TTR)"""
        intent_dist = Counter([qa.get("intent", "unknown") for qa in self.qa_list])
        total_qa = max(len(self.qa_list), 1)

        # 인텐트 엔트로피 (로그 기반 균형도)
        intent_entropy = self._calculate_entropy(intent_dist)
        # 최대 가능 엔트로피 (모든 인텐트가 균등할 때)
        max_entropy = math.log2(len(intent_dist)) if len(intent_dist) > 1 else 1.0
        intent_score = (intent_entropy / max_entropy) * 10 if len(intent_dist) > 1 else (5.0 if intent_dist else 0.0)

        # 어휘 다양성 (TTR: Type-Token Ratio)
        all_q_words = [w for qa in self.qa_list for w in qa.get("q", "").split()]
        unique_tokens = len(set(all_q_words))
        total_tokens = len(all_q_words)
        ttr = unique_tokens / max(total_tokens, 1)
        
        vocab_score = ttr * 10

        # 최종 다양성 점수 (인텐트 균형 + 어휘 다양성)
        score = (intent_score * 0.6 + vocab_score * 0.4)

        # 길이 통계
        q_lengths = [len(qa.get("q", "")) for qa in self.qa_list]
        a_lengths = [len(qa.get("a", "")) for qa in self.qa_list]
        q_avg = sum(q_lengths) / total_qa
        a_avg = sum(a_lengths) / total_qa

        return {
            "score": round(min(10, score), 2),
            "stats": {
                "intent_count":        len(intent_dist),
                "intent_distribution": dict(intent_dist),
                "intent_entropy":      intent_entropy,
                "vocabulary": {
                    "unique_tokens":   unique_tokens,
                    "total_tokens":    total_tokens,
                    "ttr":             round(ttr, 3)
                },
                "avg_lengths": {
                    "question": round(q_avg, 1),
                    "answer":   round(a_avg, 1)
                }
            }
        }

    def _analyze_duplication(self) -> Dict:
        """중복도 분석 - 문자열 유사도 기반 Near-duplicate 비율"""
        duplicates = []
        checked = set()

        # 대량 데이터 시 성능 저하 우려가 있으므로 상위 N개만 샘플링하거나 최적화 필요 (현재는 전수 조사)
        for i, qa_i in enumerate(self.qa_list):
            if i in checked:
                continue
            q_i = qa_i.get("q", "").lower()
            for j, qa_j in enumerate(self.qa_list[i + 1:], start=i + 1):
                if j in checked:
                    continue
                q_j = qa_j.get("q", "").lower()
                # 문자열 레벨 유사도 70% 이상
                if SequenceMatcher(None, q_i, q_j).ratio() >= 0.7:
                    duplicates.append((i, j))
                    checked.add(j)

        near_dup_rate = (len(duplicates) / len(self.qa_list)) * 100 if self.qa_list else 0
        score = max(0, 10 - (near_dup_rate / 2)) # 중복 20%면 0점

        return {
            "score": round(min(10, score), 2),
            "stats": {
                "duplicate_count":     len(duplicates),
                "near_duplicate_rate": round(near_dup_rate, 2),
                "method":              "string_similarity_0.7"
            }
        }

    def _analyze_skewness(self) -> Dict:
        """편향도 분석 - 특정 문서 집중도"""
        doc_dist = Counter([qa.get("docId", "unknown") for qa in self.qa_list])
        total = sum(doc_dist.values())
        doc_max_ratio = (max(doc_dist.values()) / total * 100) if total > 0 else 0

        # 편향도 점수 (문서가 골고루 분포될수록 높음)
        if doc_max_ratio <= 30:   score = 10
        elif doc_max_ratio <= 50: score = 8
        elif doc_max_ratio <= 80: score = 5
        else:                     score = 2

        return {
            "score": round(score, 2),
            "stats": {
                "doc_distribution": dict(doc_dist),
                "doc_max_ratio":    round(doc_max_ratio, 2),
                "doc_entropy":      self._calculate_entropy(doc_dist)
            }
        }

    def _analyze_sufficiency(self) -> Dict:
        """충족성 분석 - 필수 필드 채움률 및 데이터 충족도"""
        fields = ["q", "a", "context", "docId", "intent"]
        fill_rates = {}
        total = max(len(self.qa_list), 1)
        
        for field in fields:
            filled = sum(1 for qa in self.qa_list if qa.get(field))
            fill_rates[field] = round(filled / total * 100, 2)

        avg_fill = sum(fill_rates.values()) / len(fill_rates)
        score = (avg_fill / 100) * 10

        return {
            "score": round(min(10, score), 2),
            "stats": {
                "field_fill_rates": fill_rates,
                "avg_fill_rate":    round(avg_fill, 2)
            }
        }
