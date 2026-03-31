"""
DB 마이그레이션 사전 점검 스크립트
Option B 전환 전 각 테이블 현황 파악용

실행:
    python backend/scripts/inspect_db_state.py
"""

import os
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT_DIR)


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
    print("[ERROR] SUPABASE_URL / SUPABASE_KEY 환경변수 없음")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


# ─────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────

def section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


def fetch_all(table: str, columns: str = "*", limit: int = 5000) -> list:
    try:
        res = sb.table(table).select(columns).limit(limit).execute()
        return res.data or []
    except Exception as e:
        print(f"  [ERROR] {table} 조회 실패: {e}")
        return []


# ─────────────────────────────────────────────
# 1. doc_chunks
# ─────────────────────────────────────────────

def inspect_doc_chunks():
    section("1. doc_chunks")

    rows = fetch_all("doc_chunks", "id, metadata, created_at")
    total = len(rows)
    print(f"  전체 row 수: {total}")
    if total == 0:
        return

    # document_id 현황
    has_doc_id   = [r for r in rows if (r.get("metadata") or {}).get("document_id")]
    null_doc_id  = total - len(has_doc_id)
    unique_doc_ids = set((r.get("metadata") or {}).get("document_id") for r in has_doc_id)

    print(f"  metadata.document_id 있음: {len(has_doc_id)} / {total}")
    print(f"  metadata.document_id NULL:  {null_doc_id} (구행 or 마이그레이션 전 인제스션)")
    print(f"  고유 document_id 수: {len(unique_doc_ids)}")

    # filename 현황
    filenames = set((r.get("metadata") or {}).get("filename") for r in rows if (r.get("metadata") or {}).get("filename"))
    print(f"  고유 filename 수: {len(filenames)}")
    for fn in sorted(filenames):
        cnt = sum(1 for r in rows if (r.get("metadata") or {}).get("filename") == fn)
        doc_ids = set((r.get("metadata") or {}).get("document_id") for r in rows if (r.get("metadata") or {}).get("filename") == fn and (r.get("metadata") or {}).get("document_id"))
        print(f"    - {fn}: {cnt}개 청크, document_id {len(doc_ids)}개 버전")

    # hierarchy 태깅 현황
    tagged = sum(1 for r in rows if (r.get("metadata") or {}).get("hierarchy_h1"))
    print(f"  hierarchy_h1 태깅: {tagged} / {total}")

    # content_hash 현황
    hashes = [(r.get("metadata") or {}).get("content_hash") for r in rows]
    dup_hashes = len(hashes) - len(set(h for h in hashes if h))
    print(f"  content_hash 중복 수 (동일 hash 다른 row): {dup_hashes}")


# ─────────────────────────────────────────────
# 2. doc_metadata
# ─────────────────────────────────────────────

def inspect_doc_metadata():
    section("2. doc_metadata")

    rows = fetch_all("doc_metadata", "document_id, filename, domain_profile, h2_h3_master, created_at")
    total = len(rows)
    print(f"  전체 row 수: {total}")
    if total == 0:
        print("  (비어있음 — analyze-hierarchy 미실행)")
        return

    has_domain  = sum(1 for r in rows if r.get("domain_profile"))
    has_master  = sum(1 for r in rows if r.get("h2_h3_master"))
    print(f"  domain_profile 있음: {has_domain} / {total}")
    print(f"  h2_h3_master 있음:   {has_master} / {total}")

    print(f"  문서 목록:")
    for r in rows:
        doc_id = r.get("document_id", "?")[:12]
        fn     = r.get("filename", "?")
        dp     = "O" if r.get("domain_profile") else "X"
        hm     = "O" if r.get("h2_h3_master") else "X"
        print(f"    - {fn}  (id: {doc_id}...)  domain:{dp}  master:{hm}")

    # doc_chunks와 교차 점검
    chunk_rows = fetch_all("doc_chunks", "metadata")
    chunk_doc_ids = set(
        (r.get("metadata") or {}).get("document_id")
        for r in chunk_rows
        if (r.get("metadata") or {}).get("document_id")
    )
    meta_doc_ids = set(r["document_id"] for r in rows if r.get("document_id"))

    only_in_chunks = chunk_doc_ids - meta_doc_ids
    only_in_meta   = meta_doc_ids - chunk_doc_ids

    print(f"\n  doc_chunks에만 있는 document_id (doc_metadata row 없음): {len(only_in_chunks)}개")
    for d in sorted(only_in_chunks):
        print(f"    - {d[:20]}...")

    if only_in_meta:
        print(f"  doc_metadata에만 있는 document_id (청크 없음): {len(only_in_meta)}개")
        for d in sorted(only_in_meta):
            print(f"    - {d[:20]}...")


# ─────────────────────────────────────────────
# 3. qa_gen_results
# ─────────────────────────────────────────────

def inspect_qa_gen_results():
    section("3. qa_gen_results")

    rows = fetch_all("qa_gen_results", "id, job_id, source_doc, doc_chunk_ids, metadata, linked_evaluation_id, created_at")
    total = len(rows)
    print(f"  전체 row 수: {total}")
    if total == 0:
        return

    # source_doc 현황
    source_docs = set(r.get("source_doc") for r in rows if r.get("source_doc"))
    print(f"  고유 source_doc(filename) 수: {len(source_docs)}")
    for sd in sorted(source_docs):
        cnt = sum(1 for r in rows if r.get("source_doc") == sd)
        print(f"    - {sd}: {cnt}개 생성 job")

    # doc_chunk_ids 현황
    empty_chunks = sum(1 for r in rows if not r.get("doc_chunk_ids"))
    print(f"  doc_chunk_ids 비어있는 row: {empty_chunks} / {total}")

    # linked_evaluation_id 현황
    linked = sum(1 for r in rows if r.get("linked_evaluation_id"))
    print(f"  linked_evaluation_id 있음: {linked} / {total}")

    # document_id in metadata 확인 (현재 저장 안 됨 확인용)
    has_meta_docid = sum(1 for r in rows if (r.get("metadata") or {}).get("document_id"))
    print(f"  metadata 내 document_id 있음: {has_meta_docid} / {total}  (0이면 정상 — 현재 저장 안 됨)")

    # doc_chunk_ids → doc_chunks.document_id 역추적 가능 여부 샘플 확인
    print(f"\n  [doc_chunk_ids → document_id 역추적 샘플]")
    chunk_ids_flat = []
    for r in rows:
        ids = r.get("doc_chunk_ids") or []
        if ids:
            chunk_ids_flat.append((r["id"], ids[0]))

    sample = chunk_ids_flat[:5]
    if sample:
        all_first_ids = [cid for _, cid in sample]
        try:
            chunk_res = sb.table("doc_chunks").select("id, metadata").in_("id", all_first_ids).execute()
            chunk_map = {c["id"]: (c.get("metadata") or {}).get("document_id") for c in (chunk_res.data or [])}
            for gen_id, chunk_id in sample:
                doc_id = chunk_map.get(chunk_id, "NOT FOUND")
                status = "OK" if doc_id and doc_id != "NOT FOUND" else "FAIL"
                print(f"    gen={gen_id[:12]}... chunk={chunk_id[:12]}... → doc_id={str(doc_id)[:16]}... [{status}]")
        except Exception as e:
            print(f"    [ERROR] 샘플 역추적 실패: {e}")
    else:
        print("    doc_chunk_ids 있는 row 없음")


# ─────────────────────────────────────────────
# 4. qa_eval_results
# ─────────────────────────────────────────────

def inspect_qa_eval_results():
    section("4. qa_eval_results")

    rows = fetch_all("qa_eval_results", "id, job_id, total_qa, valid_qa, final_score, final_grade, created_at")
    total = len(rows)
    print(f"  전체 row 수: {total}")
    if total == 0:
        return

    # linked_evaluation_id로 역방향 백필 가능 여부
    gen_rows = fetch_all("qa_gen_results", "id, linked_evaluation_id")
    linkable_eval_ids = set(
        r["linked_evaluation_id"] for r in gen_rows if r.get("linked_evaluation_id")
    )
    eval_ids = set(r["id"] for r in rows)

    backfillable = len(eval_ids & linkable_eval_ids)
    no_backfill  = len(eval_ids - linkable_eval_ids)

    print(f"  generation_id 역방향 백필 가능 (linked_evaluation_id로 연결): {backfillable} / {total}")
    print(f"  백필 불가 (qa_gen_results 연결 없음):                         {no_backfill} / {total}")

    # 점수 분포 요약
    grades = {}
    for r in rows:
        g = r.get("final_grade", "?")
        grades[g] = grades.get(g, 0) + 1
    scores = [r["final_score"] for r in rows if r.get("final_score") is not None]
    if scores:
        avg = sum(scores) / len(scores)
        print(f"  final_score 평균: {avg:.3f}  (최소: {min(scores):.3f}, 최대: {max(scores):.3f})")
    print(f"  등급 분포: {dict(sorted(grades.items()))}")

    print(f"\n  최근 5개 평가:")
    for r in sorted(rows, key=lambda x: x.get("created_at",""), reverse=True)[:5]:
        print(f"    - [{r.get('final_grade','?')}] score={r.get('final_score','?')}  total_qa={r.get('total_qa','?')}  {r.get('created_at','?')[:16]}")


# ─────────────────────────────────────────────
# 5. 마이그레이션 사전 점검 요약
# ─────────────────────────────────────────────

def migration_readiness_summary():
    section("5. 마이그레이션 사전 점검 요약")

    # doc_chunks null 수
    chunk_rows = fetch_all("doc_chunks", "metadata")
    total_chunks = len(chunk_rows)
    null_doc_id  = sum(1 for r in chunk_rows if not (r.get("metadata") or {}).get("document_id"))
    chunk_doc_ids = set(
        (r.get("metadata") or {}).get("document_id")
        for r in chunk_rows
        if (r.get("metadata") or {}).get("document_id")
    )

    # doc_metadata 미매핑 수
    meta_rows = fetch_all("doc_metadata", "document_id")
    meta_doc_ids = set(r["document_id"] for r in meta_rows if r.get("document_id"))
    unmapped_in_chunks = chunk_doc_ids - meta_doc_ids

    # qa_gen_results 백필 가능 여부
    gen_rows = fetch_all("qa_gen_results", "id, doc_chunk_ids, source_doc")
    total_gen = len(gen_rows)
    empty_chunk_ids = sum(1 for r in gen_rows if not r.get("doc_chunk_ids"))

    print(f"  [Step 1] doc_chunks UPDATE 대상: {total_chunks}행")
    print(f"           → document_id NULL 예상: {null_doc_id}행 {'(주의)' if null_doc_id > 0 else '(없음)'}")

    print(f"\n  [Step 2] doc_metadata 선행 INSERT 필요 document_id: {len(unmapped_in_chunks)}개")
    if unmapped_in_chunks:
        print(f"           → analyze-hierarchy 미실행 문서 존재, Step 2-a 필수")
    else:
        print(f"           → 모든 document_id에 doc_metadata row 있음, Step 2-a 불필요")

    print(f"\n  [Step 3] qa_gen_results 백필 대상: {total_gen}행")
    print(f"           → doc_chunk_ids 비어있는 행: {empty_chunk_ids}행 {'(source_doc 폴백 필요)' if empty_chunk_ids > 0 else ''}")

    print(f"\n  [판정]")
    issues = []
    if null_doc_id > 0:
        issues.append(f"doc_chunks NULL {null_doc_id}행 — 재인제스션 또는 허용 여부 결정 필요")
    if unmapped_in_chunks:
        issues.append(f"doc_metadata 미매핑 {len(unmapped_in_chunks)}개 — Step 2-a 선행 삽입 필수")
    if empty_chunk_ids > 0:
        issues.append(f"qa_gen_results doc_chunk_ids 공백 {empty_chunk_ids}행 — source_doc 폴백으로 처리")

    if issues:
        print(f"  주의사항:")
        for i in issues:
            print(f"    - {i}")
    else:
        print(f"  문제 없음 — 마이그레이션 진행 가능")


# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("AutoEval DB 마이그레이션 사전 점검")
    print(f"대상: {SUPABASE_URL}")

    inspect_doc_chunks()
    inspect_doc_metadata()
    inspect_qa_gen_results()
    inspect_qa_eval_results()
    migration_readiness_summary()

    print(f"\n{'='*60}")
    print("  점검 완료")
    print('='*60)
