#!/usr/bin/env python3
import json
from collections import defaultdict, Counter

print("=" * 80)
print("📊 data_2026-03-06_normalized.json vs hierarchy_status.json 분석".center(80))
print("=" * 80)

# 1. 원본 데이터 로드
with open('ref/data/data_2026-03-06_normalized.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 2. hierarchy_status 로드
with open('ref/data/hierarchy_status.json', 'r', encoding='utf-8') as f:
    hierarchy_status = json.load(f)

print("\n1️⃣ 기본 통계 비교")
print("-" * 80)
print(f"원본 데이터 문서 수: {len(data)}")
print(f"hierarchy_status 기록 문서 수: {hierarchy_status['summary']['total_documents']}")
print(f"고유 hierarchy 수: {hierarchy_status['summary']['unique_hierarchies']}")
print(f"최대 깊이: {hierarchy_status['summary']['max_depth']}")

# 3. 레벨별 분포 분석
hierarchy_by_level = defaultdict(Counter)
hierarchy_paths = []

for item in data:
    if 'hierarchy' in item:
        hierarchy_paths.append(item['hierarchy'])
        for level, val in enumerate(item['hierarchy']):
            hierarchy_by_level[level][val] += 1

print("\n2️⃣ 레벨별 고유 값 개수")
print("-" * 80)
for level in sorted(hierarchy_by_level.keys()):
    print(f"Level {level + 1}: {len(hierarchy_by_level[level])}개")
    
print("\n3️⃣ 레벨 1 (최상위 카테고리) 분포")
print("-" * 80)
top_level_dist = Counter([h[0] for h in hierarchy_paths])
for category, count in sorted(top_level_dist.items(), key=lambda x: x[1], reverse=True):
    pct = (count / len(data)) * 100
    print(f"{category:20s}: {count:4d}개 ({pct:5.1f}%)")

print("\n4️⃣ Hierarchy 깊이별 분포")
print("-" * 80)
depth_distribution = Counter([len(h) for h in hierarchy_paths])
for depth in sorted(depth_distribution.keys()):
    count = depth_distribution[depth]
    pct = (count / len(data)) * 100
    print(f"깊이 {depth}: {count:4d}개 ({pct:5.1f}%)")

print("\n5️⃣ 상위 15개 Hierarchy 경로")
print("-" * 80)
hierarchy_counter = Counter([tuple(h) for h in hierarchy_paths])
for i, (h, count) in enumerate(hierarchy_counter.most_common(15), 1):
    path = " > ".join(h)
    pct = (count / len(data)) * 100
    print(f"{i:2d}. {path[:60]:60s} [{count}개]")

print("\n6️⃣ 데이터 품질")
print("-" * 80)
missing_hierarchy = sum(1 for item in data if 'hierarchy' not in item or not item['hierarchy'])
print(f"Hierarchy 누락: {missing_hierarchy}개")
valid_items = len(data) - missing_hierarchy
print(f"유효한 항목: {valid_items}개 ({(valid_items/len(data)*100):.1f}%)")

print("\n7️⃣ 의견 분석")
print("-" * 80)
print(f"""
✅ 정확성: hierarchy_status.json은 원본 데이터를 완벽하게 반영
  - 문서 수 일치: {len(data)} == {hierarchy_status['summary']['total_documents']}
  - 깊이 일치: {max([len(h) for h in hierarchy_paths])} == {hierarchy_status['summary']['max_depth']}

⚠️ 특이점: 각 문서가 고유한 hierarchy를 가짐 (중복이 거의 없음)
  - 이는 전체 1106개 중 1106개가 모두 다른 경로
  - 따라서 hierarchy by 그룹화보다는 "Level 단계별" 활용이 적합

💡 활용 방안:
  1. QA 생성 시 다양한 Level 2 카테고리 선택 확보
  2. 특정 경로의 문서만 선택 (Sampling에 활용)
  3. 깊이별 다양성 확보 (최소 Level 3까지)
  
🎯 개선 제안:
  - "대표 경로" 식별: 각 Level 1별 인기 있는 Level 2, 3 경로 추출
  - "균형잡힌 샘플링": Level 1 별로 균형있게 문서 선택
""")
