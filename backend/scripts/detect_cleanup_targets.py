"""
DB 정리 대상 탐지 스크립트
마이그레이션 전 정리가 필요한 데이터를 찾아 JSON으로 저장

실행:
    python backend/scripts/detect_cleanup_targets.py

출력:
    backend/scripts/cleanup_targets.json  — 정리 대상 목록
    backend/scripts/cleanup_queries.sql   — 실행 가능한 DELETE/정리 쿼리
"""

import json
import os
import sys
from datetime import datetime
from collections import defaultdict

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT_DIR)

SCRIPTS_DIR = os.path.join(ROOT_DIR, "backend", "scripts")


def load_env():
    env_path = os.path.join(ROOT_DIR, ".env")
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split("=", 1)
                if len(parts) == 2:
                    key, val = parts
                    os.environ[key] = val.strip('"').strip("'").split("#")[0].strip()
    except Exception as e:
        print(f"[WARN] .env load failed: {e}")


load_env()

from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] SUPABASE_URL / SUPABASE_KEY 없음")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch(table, columns="*", limit=5000):
    try:
        res = sb.table(table).select(columns).limit(limit).execute()
        return res.data or []
    except Exception as e:
        print(f"  [ERROR] {table} 조회 실패: {e}")
        return []


# ─────────────────────────────────────────────
# 탐지 1: doc_chunks 구버전 중복 (같은 filename, 여러 document_id)
# ─────────────────────────────────────────────

def detect_old_chunk_versions():
    """
    동일 filename에 document_id 버전이 2개 이상인 경우,
    created_at 기준 최신 1개만 남기고 나머지를 정리 대상으로 탐지.
    """
    print("\n[1] doc_chunks 구버전 탐지 중...")

    rows = fetch("doc_chunks", "id, document_id, metadata, created_at")

    # filename별로 document_id + 대표 created_at 수집
    file_versions = defaultdict(dict)  # filename -> {document_id: latest_created_at}
    for r in rows:
        meta = r.get("metadata") or {}
        fn = meta.get("filename")
        doc_id = r.get("document_id") or meta.get("document_id")
        created_at = r.get("created_at", "")
        if fn and doc_id:
            if doc_id not in file_versions[fn]:
                file_versions[fn][doc_id] = created_at
            else:
                if created_at > file_versions[fn][doc_id]:
                    file_versions[fn][doc_id] = created_at

    targets = []
    for fn, versions in file_versions.items():
        if len(versions) <= 1:
            continue

        # created_at 기준 정렬 → 최신 1개 유지, 나머지 정리 대상
        sorted_versions = sorted(versions.items(), key=lambda x: x[1], reverse=True)
        keep_doc_id = sorted_versions[0][0]
        old_versions = sorted_versions[1:]

        for old_doc_id, old_ts in old_versions:
            chunk_ids = [
                r["id"] for r in rows
                if (r.get("metadata") or {}).get("document_id") == old_doc_id
            ]
            targets.append({
                "filename": fn,
                "document_id": old_doc_id,
                "version_created_at": old_ts,
                "keep_document_id": keep_doc_id,
                "keep_created_at": sorted_versions[0][1],
                "chunk_count": len(chunk_ids),
                "chunk_ids": chunk_ids,
            })
        print(f"  {fn}: {len(versions)}개 버전 → {len(old_versions)}개 구버전 탐지 (유지: {keep_doc_id[:12]}...)")

    total_chunks = sum(t["chunk_count"] for t in targets)
    print(f"  → 정리 대상: {len(targets)}개 구버전, {total_chunks}개 청크")
    return targets


# ─────────────────────────────────────────────
# 탐지 2: doc_metadata 고아 row (대응 청크 없음)
# ─────────────────────────────────────────────

def detect_orphan_doc_metadata():
    """
    doc_metadata에는 있지만 doc_chunks에 해당 document_id 청크가 없는 row.
    """
    print("\n[2] doc_metadata 고아 row 탐지 중...")

    meta_rows = fetch("doc_metadata", "id, document_id, filename, created_at")
    chunk_rows = fetch("doc_chunks", "metadata")

    chunk_doc_ids = set(
        (r.get("metadata") or {}).get("document_id")
        for r in chunk_rows
        if (r.get("metadata") or {}).get("document_id")
    )

    orphans = []
    for r in meta_rows:
        doc_id = r.get("document_id")
        if doc_id and doc_id not in chunk_doc_ids:
            orphans.append({
                "id": r["id"],
                "document_id": doc_id,
                "filename": r.get("filename", ""),
                "created_at": r.get("created_at", ""),
                "reason": "doc_chunks에 해당 document_id 청크 없음",
            })
            print(f"  고아: {r.get('filename','')}  (doc_id: {doc_id[:12]}...)")

    print(f"  → 정리 대상: {len(orphans)}개 row")
    return orphans


# ─────────────────────────────────────────────
# 탐지 3: qa_eval_results 고아 row (qa_gen_results 연결 없음)
# ─────────────────────────────────────────────

def detect_orphan_eval_results():
    """
    qa_eval_results에는 있지만 qa_gen_results.linked_evaluation_id로
    참조되지 않는 평가 row.
    """
    print("\n[3] qa_eval_results 고아 row 탐지 중...")

    eval_rows = fetch("qa_eval_results", "id, job_id, total_qa, final_score, final_grade, created_at, metadata")
    gen_rows  = fetch("qa_gen_results", "id, linked_evaluation_id")

    linked_eval_ids = set(
        r["linked_evaluation_id"] for r in gen_rows if r.get("linked_evaluation_id")
    )

    orphans = []
    for r in eval_rows:
        if r["id"] not in linked_eval_ids:
            orphans.append({
                "id": r["id"],
                "job_id": r.get("job_id", ""),
                "total_qa": r.get("total_qa"),
                "final_score": r.get("final_score"),
                "final_grade": r.get("final_grade"),
                "created_at": r.get("created_at", ""),
                "source_doc": (r.get("metadata") or {}).get("source_doc", ""),
                "reason": "qa_gen_results.linked_evaluation_id 참조 없음",
            })
            print(f"  고아: [{r.get('final_grade','?')}] score={r.get('final_score','?')}  {r.get('created_at','?')[:16]}")

    print(f"  → 정리 대상: {len(orphans)}개 row")
    return orphans


# ─────────────────────────────────────────────
# 탐지 4: content_hash 중복 청크 (같은 hash, 같은 document_id)
# ─────────────────────────────────────────────

def detect_duplicate_chunks():
    """
    동일 (content_hash, document_id) 쌍이 2개 이상인 경우.
    가장 오래된 것 유지, 나머지 정리 대상.
    """
    print("\n[4] content_hash 중복 청크 탐지 중...")

    rows = fetch("doc_chunks", "id, metadata, created_at")

    pair_map = defaultdict(list)  # (content_hash, document_id) -> [(id, created_at)]
    for r in rows:
        meta = r.get("metadata") or {}
        h = meta.get("content_hash")
        d = meta.get("document_id")
        if h and d:
            pair_map[(h, d)].append((r["id"], r.get("created_at", "")))

    dup_ids = []
    dup_groups = []
    for (h, d), entries in pair_map.items():
        if len(entries) <= 1:
            continue
        sorted_entries = sorted(entries, key=lambda x: x[1])
        keep_id = sorted_entries[0][0]
        remove = sorted_entries[1:]
        dup_groups.append({
            "content_hash": h,
            "document_id": d,
            "keep_id": keep_id,
            "remove_ids": [e[0] for e in remove],
            "remove_count": len(remove),
        })
        dup_ids.extend([e[0] for e in remove])

    print(f"  → 중복 그룹: {len(dup_groups)}개, 정리 대상 청크: {len(dup_ids)}개")
    return dup_groups, dup_ids


# ─────────────────────────────────────────────
# SQL 생성
# ─────────────────────────────────────────────

def build_sql(old_versions, orphan_meta, orphan_eval, dup_chunk_ids):
    lines = [
        "-- ============================================================",
        "-- AutoEval DB 정리 쿼리",
        f"-- 생성일: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "-- 주의: 실행 전 반드시 백업 테이블 생성 후 진행",
        "-- ============================================================",
        "",
        "-- [사전] 백업 테이블 생성 (마이그레이션 전 1회 실행)",
        "-- CREATE TABLE doc_chunks_bak      AS SELECT * FROM doc_chunks;",
        "-- CREATE TABLE qa_gen_results_bak  AS SELECT * FROM qa_gen_results;",
        "-- CREATE TABLE qa_eval_results_bak AS SELECT * FROM qa_eval_results;",
        "",
    ]

    # 1. 구버전 청크 삭제
    lines.append("-- ============================================================")
    lines.append("-- [1] doc_chunks 구버전 삭제")
    lines.append(f"--     대상: {sum(t['chunk_count'] for t in old_versions)}개 청크")
    lines.append("-- ============================================================")
    if old_versions:
        for t in old_versions:
            ids_sql = ", ".join(f"'{i}'" for i in t["chunk_ids"])
            lines.append(f"-- {t['filename']} (document_id: {t['document_id'][:12]}..., {t['chunk_count']}개)")
            lines.append(f"DELETE FROM doc_chunks WHERE id IN ({ids_sql});")
            lines.append("")
    else:
        lines.append("-- 정리 대상 없음")
        lines.append("")

    # 1-b. 구버전 doc_metadata 삭제 (청크 삭제 후)
    if old_versions:
        lines.append("-- [1-b] 구버전 document_id에 해당하는 doc_metadata 삭제 (청크 삭제 완료 후)")
        old_doc_ids = [f"'{t['document_id']}'" for t in old_versions]
        lines.append(f"DELETE FROM doc_metadata WHERE document_id IN ({', '.join(old_doc_ids)});")
        lines.append("")

    # 2. doc_metadata 고아 삭제
    lines.append("-- ============================================================")
    lines.append("-- [2] doc_metadata 고아 row 삭제 (청크 없는 메타데이터)")
    lines.append(f"--     대상: {len(orphan_meta)}개 row")
    lines.append("-- ============================================================")
    if orphan_meta:
        ids_sql = ", ".join(f"'{r['id']}'" for r in orphan_meta)
        lines.append(f"DELETE FROM doc_metadata WHERE id IN ({ids_sql});")
    else:
        lines.append("-- 정리 대상 없음")
    lines.append("")

    # 3. qa_eval_results 고아 삭제
    lines.append("-- ============================================================")
    lines.append("-- [3] qa_eval_results 고아 row 삭제 (생성 연결 없는 평가)")
    lines.append(f"--     대상: {len(orphan_eval)}개 row")
    lines.append("-- ============================================================")
    if orphan_eval:
        ids_sql = ", ".join(f"'{r['id']}'" for r in orphan_eval)
        lines.append(f"DELETE FROM qa_eval_results WHERE id IN ({ids_sql});")
    else:
        lines.append("-- 정리 대상 없음")
    lines.append("")

    # 4. content_hash 중복 청크 삭제
    lines.append("-- ============================================================")
    lines.append("-- [4] content_hash 중복 청크 삭제 (같은 hash+document_id 중 구버전)")
    lines.append(f"--     대상: {len(dup_chunk_ids)}개 청크")
    lines.append("-- ============================================================")
    if dup_chunk_ids:
        # 배치로 분할 (SQL 길이 제한 방지)
        batch_size = 100
        for i in range(0, len(dup_chunk_ids), batch_size):
            batch = dup_chunk_ids[i:i+batch_size]
            ids_sql = ", ".join(f"'{cid}'" for cid in batch)
            lines.append(f"DELETE FROM doc_chunks WHERE id IN ({ids_sql});")
    else:
        lines.append("-- 정리 대상 없음")
    lines.append("")

    # 5. 정리 후 검증 쿼리
    lines.append("-- ============================================================")
    lines.append("-- [검증] 정리 후 상태 확인")
    lines.append("-- ============================================================")
    lines.append("SELECT COUNT(*) AS total_chunks FROM doc_chunks;")
    lines.append("SELECT COUNT(DISTINCT metadata->>'document_id') AS unique_doc_ids FROM doc_chunks;")
    lines.append("SELECT COUNT(DISTINCT metadata->>'filename') AS unique_filenames FROM doc_chunks;")
    lines.append("SELECT COUNT(*) AS total_doc_metadata FROM doc_metadata;")
    lines.append("SELECT COUNT(*) AS total_qa_gen FROM qa_gen_results;")
    lines.append("SELECT COUNT(*) AS total_qa_eval FROM qa_eval_results;")
    lines.append("")
    lines.append("-- 고아 doc_metadata 잔여 확인 (0이어야 정상)")
    lines.append("""SELECT COUNT(*) AS orphan_metadata
FROM doc_metadata m
WHERE NOT EXISTS (
    SELECT 1 FROM doc_chunks c
    WHERE c.metadata->>'document_id' = m.document_id
);""")
    lines.append("")
    lines.append("-- content_hash 중복 잔여 확인 (0이어야 정상)")
    lines.append("""SELECT COUNT(*) AS remaining_duplicates
FROM (
    SELECT metadata->>'content_hash' AS h, metadata->>'document_id' AS d, COUNT(*) AS cnt
    FROM doc_chunks
    WHERE metadata->>'content_hash' IS NOT NULL
    GROUP BY h, d
    HAVING COUNT(*) > 1
) dup;""")

    return "\n".join(lines)


# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  AutoEval DB 정리 대상 탐지")
    print(f"  대상: {SUPABASE_URL}")
    print("=" * 60)

    old_versions = detect_old_chunk_versions()
    orphan_meta  = detect_orphan_doc_metadata()
    orphan_eval  = detect_orphan_eval_results()
    dup_groups, dup_chunk_ids = detect_duplicate_chunks()

    # JSON 저장
    result = {
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "old_chunk_versions": len(old_versions),
            "old_chunk_versions_total_chunks": sum(t["chunk_count"] for t in old_versions),
            "orphan_doc_metadata": len(orphan_meta),
            "orphan_eval_results": len(orphan_eval),
            "duplicate_chunk_groups": len(dup_groups),
            "duplicate_chunks_to_remove": len(dup_chunk_ids),
        },
        "old_chunk_versions": old_versions,
        "orphan_doc_metadata": orphan_meta,
        "orphan_eval_results": orphan_eval,
        "duplicate_chunk_groups": dup_groups,
    }

    json_path = os.path.join(SCRIPTS_DIR, "cleanup_targets.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n[저장] {json_path}")

    # SQL 저장
    sql_content = build_sql(old_versions, orphan_meta, orphan_eval, dup_chunk_ids)
    sql_path = os.path.join(SCRIPTS_DIR, "cleanup_queries.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(sql_content)
    print(f"[저장] {sql_path}")

    print("\n" + "=" * 60)
    print("  탐지 요약")
    print("=" * 60)
    s = result["summary"]
    print(f"  구버전 doc_chunks:        {s['old_chunk_versions']}개 버전 ({s['old_chunk_versions_total_chunks']}개 청크)")
    print(f"  고아 doc_metadata:        {s['orphan_doc_metadata']}개 row")
    print(f"  고아 qa_eval_results:     {s['orphan_eval_results']}개 row")
    print(f"  content_hash 중복 청크:   {s['duplicate_chunks_to_remove']}개 청크 ({s['duplicate_chunk_groups']}개 그룹)")
    print("\n  cleanup_targets.json, cleanup_queries.sql 생성 완료")
    print("  실행 전 반드시 백업 테이블 생성 후 진행할 것")
    print("=" * 60)
