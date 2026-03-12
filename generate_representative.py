#!/usr/bin/env python3
import json
from collections import defaultdict, Counter

print("=" * 80)
print("🎯 Representative Hierarchies 생성".center(80))
print("=" * 80)

# 1. 원본 데이터 로드
with open('ref/data/data_2026-03-06_normalized.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 2. Level 1 별로 문서 그룹화
group_by_level1 = defaultdict(list)
for item in data:
    if 'hierarchy' in item and len(item['hierarchy']) > 0:
        l1 = item['hierarchy'][0]
        group_by_level1[l1].append(item)

# 3. 대표 경로 식별
representative = {
    "generated": "2026-03-12",
    "source": "data_2026-03-06_normalized.json",
    "summary": {
        "total_documents": len(data),
        "level1_categories": len(group_by_level1),
        "sampling_options": [
            "random - 무작위 선택",
            "balanced - Level 1별 균형있게 선택",
            "category - 특정 카테고리만 선택",
            "path - 특정 경로만 선택"
        ]
    },
    "by_level1": {}
}

# 4. Level 1별 상세 정보 추출
for l1_name in sorted(group_by_level1.keys()):
    docs_in_l1 = group_by_level1[l1_name]
    
    # Level 2 분석
    l2_counter = Counter()
    l2_docs = defaultdict(list)
    path_counter = Counter()
    
    for item in docs_in_l1:
        h = item['hierarchy']
        if len(h) > 1:
            l2 = h[1]
            l2_counter[l2] += 1
            l2_docs[l2].append(item)
            
        # 전체 경로
        path = " > ".join(h)
        path_counter[path] += 1
    
    representative["by_level1"][l1_name] = {
        "total_documents": len(docs_in_l1),
        "percentage": round((len(docs_in_l1) / len(data) * 100), 1),
        "level2_distribution": [
            {
                "name": l2,
                "count": count,
                "percentage": round((count / len(docs_in_l1) * 100), 1)
            }
            for l2, count in l2_counter.most_common(10)
        ],
        "depth_distribution": {
            "min": min([len(item['hierarchy']) for item in docs_in_l1]),
            "max": max([len(item['hierarchy']) for item in docs_in_l1]),
            "avg": round(sum([len(item['hierarchy']) for item in docs_in_l1]) / len(docs_in_l1), 1)
        },
        "top_paths": [
            {
                "path": path,
                "count": count
            }
            for path, count in path_counter.most_common(5)
        ]
    }

# 5. 파일 저장
with open('ref/data/representative_hierarchies.json', 'w', encoding='utf-8') as f:
    json.dump(representative, f, ensure_ascii=False, indent=2)

print("\n✅ representative_hierarchies.json 생성 완료!\n")

# 6. 콘솔 출력
print("📊 Level 1별 통계:")
print("-" * 80)
for l1, count in sorted(group_by_level1.items(), key=lambda x: len(x[1]), reverse=True):
    pct = (len(group_by_level1[l1]) / len(data) * 100)
    print(f"\n{l1} ({len(group_by_level1[l1])}개, {pct:.1f}%)")
    
    # Level 2 상위 3개
    l2_counter = Counter()
    for item in group_by_level1[l1]:
        if len(item['hierarchy']) > 1:
            l2_counter[item['hierarchy'][1]] += 1
    
    for l2, l2_count in l2_counter.most_common(3):
        l2_pct = (l2_count / len(group_by_level1[l1]) * 100)
        print(f"  ├─ {l2}: {l2_count}개 ({l2_pct:.1f}%)")

print("\n" + "=" * 80)
print("💡 QA 생성 시 활용 방법:")
print("=" * 80)
print("""
1️⃣ Balanced Sampling (권장)
   POST /api/generate
   {
     "sampling": "balanced",
     "samples": 10,
     "distribution": {
       "상품": 5,
       "고객지원": 3,
       "Shop": 2
     }
   }

2️⃣ Category 선택
   POST /api/generate
   {
     "sampling": "category",
     "category": "상품",
     "samples": 10
   }

3️⃣ Path 기반 선택
   POST /api/generate
   {
     "sampling": "path",
     "path_prefix": "상품 > 모바일",
     "samples": 5
   }

4️⃣ Random (기존 방식)
   POST /api/generate
   {
     "sampling": "random",
     "samples": 10
   }
""")
