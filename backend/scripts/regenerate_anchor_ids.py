"""
구버전 청크 삭제 후 anchor_ids 재생성 스크립트 (LLM 호출 없음)
각 파일의 최신 document_id 청크에서 균등 샘플링하여 anchor_ids를 JSON으로 저장.

실행:
    python backend/scripts/regenerate_anchor_ids.py

출력:
    backend/scripts/anchor_ids_regen.json  — 파일별 anchor_ids + document_id
    브라우저 콘솔용 localStorage 복원 코드 출력

사용:
    1. 이 스크립트 실행
    2. 출력된 console_script 내용을 브라우저 개발자도구 Console에 붙여넣기
"""

import json
import os
import sys
import random

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
                    k, v = parts
                    os.environ[k] = v.strip('"').strip("'").split("#")[0].strip()
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

SAMPLE_N = 30  # ingestion_api.py anchor_chunks[:30]와 동일


def _is_admin_anchor(text: str) -> bool:
    """ingestion_api.py의 _is_admin_anchor 로직과 동일"""
    if not text:
        return False
    text_lower = text.lower()
    admin_keywords = ["목차", "차례", "contents", "index", "부록", "별표", "별지", "서식"]
    if any(kw in text_lower for kw in admin_keywords):
        return True
    if len(text.strip()) < 50:
        return True
    return False


def get_latest_document_id(filename: str) -> str | None:
    """filename 기준 가장 최신 document_id 반환"""
    try:
        # doc_metadata에서 최신 우선
        res = sb.table("doc_metadata") \
            .select("document_id, created_at") \
            .eq("filename", filename) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()
        if res.data:
            return res.data[0]["document_id"]
    except Exception:
        pass

    # doc_metadata 없으면 doc_chunks에서 직접 추출
    try:
        res = sb.table("doc_chunks") \
            .select("metadata, created_at") \
            .eq("metadata->>filename", filename) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()
        if res.data:
            return (res.data[0].get("metadata") or {}).get("document_id")
    except Exception:
        pass

    return None


def sample_chunks(filename: str, document_id: str, n: int = SAMPLE_N) -> list:
    """
    최신 document_id 청크에서 균등 샘플링.
    ingestion_api의 sample_doc_chunks RPC 사용, 없으면 직접 SELECT.
    """
    try:
        res = sb.rpc("sample_doc_chunks", {
            "p_filename": filename,
            "p_n": n,
            "p_document_id": document_id,
        }).execute()
        if res.data:
            return res.data
    except Exception:
        pass

    # RPC 실패 시 직접 SELECT 후 랜덤 샘플
    try:
        res = sb.table("doc_chunks") \
            .select("id, content") \
            .eq("metadata->>filename", filename) \
            .eq("metadata->>document_id", document_id) \
            .limit(500) \
            .execute()
        rows = res.data or []
        # admin 청크 필터
        filtered = [r for r in rows if not _is_admin_anchor(r.get("content", ""))]
        if len(filtered) < 10:
            filtered = rows
        return random.sample(filtered, min(n, len(filtered)))
    except Exception as e:
        print(f"  [ERROR] 샘플링 실패 ({filename}): {e}")
        return []


if __name__ == "__main__":
    print("=" * 60)
    print("  anchor_ids 재생성 (LLM 호출 없음)")
    print("=" * 60)

    # cleanup_targets.json에서 파일별 keep_document_id 로드
    cleanup_json = os.path.join(SCRIPTS_DIR, "cleanup_targets.json")
    keep_map = {}  # filename -> keep_document_id
    if os.path.exists(cleanup_json):
        with open(cleanup_json, encoding="utf-8") as f:
            ct = json.load(f)
        for t in ct.get("old_chunk_versions", []):
            keep_map[t["filename"]] = t["keep_document_id"]
        print(f"  cleanup_targets.json 로드: {len(keep_map)}개 파일 keep_document_id 확인")
    else:
        print("  [WARN] cleanup_targets.json 없음 — doc_metadata latest 기준으로 fallback")

    # 현재 DB의 고유 filename 목록
    try:
        res = sb.table("doc_chunks").select("metadata").limit(5000).execute()
        all_rows = res.data or []
    except Exception as e:
        print(f"[ERROR] doc_chunks 조회 실패: {e}")
        sys.exit(1)

    filenames = sorted(set(
        (r.get("metadata") or {}).get("filename")
        for r in all_rows
        if (r.get("metadata") or {}).get("filename")
    ))

    print(f"  대상 파일: {len(filenames)}개\n")

    result = {}
    console_lines = []

    for fn in filenames:
        # keep_document_id 우선 사용, 없으면 latest 조회 (단일 버전 파일)
        doc_id = keep_map.get(fn) or get_latest_document_id(fn)
        if not doc_id:
            print(f"  [{fn}] document_id 없음 — 건너뜀")
            continue

        source = "cleanup_targets" if fn in keep_map else "latest"
        chunks = sample_chunks(fn, doc_id, n=SAMPLE_N)
        anchor_ids = [c["id"] for c in chunks]

        result[fn] = {
            "document_id": doc_id,
            "anchor_ids": anchor_ids,
            "anchor_count": len(anchor_ids),
        }

        status = "✅" if len(anchor_ids) >= 10 else "⚠️ 적음"
        print(f"  [{fn}]  ({source})")
        print(f"    document_id: {doc_id[:12]}...  anchor_ids: {len(anchor_ids)}개  {status}")

        # 브라우저 콘솔 복원 코드 생성
        console_lines.append(f"// {fn}")
        console_lines.append(f"localStorage.setItem('anchor_ids:{fn}', JSON.stringify({json.dumps(anchor_ids)}));")
        console_lines.append(f"localStorage.setItem('document_id:{fn}', '{doc_id}');")
        console_lines.append("")

    # JSON 저장
    json_path = os.path.join(SCRIPTS_DIR, "anchor_ids_regen.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n[저장] {json_path}")

    # 콘솔 스크립트 저장
    console_path = os.path.join(SCRIPTS_DIR, "anchor_ids_localstorage.js")
    with open(console_path, "w", encoding="utf-8") as f:
        f.write("// ============================================================\n")
        f.write("// anchor_ids localStorage 복원 스크립트\n")
        f.write("// 브라우저 개발자도구 Console 탭에 붙여넣기\n")
        f.write("// ============================================================\n\n")
        f.write("\n".join(console_lines))
        f.write("\nconsole.log('anchor_ids 복원 완료');\n")
    print(f"[저장] {console_path}")

    print("\n" + "=" * 60)
    print("  사용 방법")
    print("=" * 60)
    print("  1. 구버전 청크 삭제 완료 후 이 스크립트 실행")
    print("  2. anchor_ids_localstorage.js 내용을")
    print("     브라우저 개발자도구 Console에 붙여넣기")
    print("  3. QA 생성 시 자동으로 최신 anchor_ids 사용됨")
    print("  ※ LLM 호출 없음 — API 비용 0")
    print("=" * 60)
