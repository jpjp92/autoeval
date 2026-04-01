"""
최근 qa_eval_results 레코드의 scores / pipeline_results 상세 점검
실행: python backend/scripts/inspect_eval_scores.py [N]
  N: 최근 N개 조회 (기본 3)
"""

import json
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

N = int(sys.argv[1]) if len(sys.argv) > 1 else 3


def sep(title=""):
    print(f"\n{'─'*60}")
    if title:
        print(f"  {title}")
        print(f"{'─'*60}")


rows = (
    sb.table("qa_eval_results")
    .select("id, job_id, total_qa, valid_qa, final_score, final_grade, created_at, metadata, scores, pipeline_results")
    .order("created_at", desc=True)
    .limit(N)
    .execute()
    .data or []
)

print(f"\n최근 qa_eval_results {len(rows)}건 상세 점검")

for r in rows:
    sep(f"[{r.get('final_grade','?')}] score={r.get('final_score','?')}  {r.get('created_at','')[:16]}")
    print(f"  id       : {r.get('id')}")
    print(f"  job_id   : {r.get('job_id')}")
    print(f"  total_qa : {r.get('total_qa')}  valid_qa: {r.get('valid_qa')}")

    # metadata
    meta = r.get("metadata") or {}
    print(f"\n  [metadata]")
    for k, v in meta.items():
        print(f"    {k}: {v!r}")

    # scores (RAG / Quality summary)
    scores = r.get("scores") or {}
    print(f"\n  [scores]")
    if not scores:
        print("    (없음 — scores 컬럼 NULL)")
    else:
        for layer, val in scores.items():
            print(f"    {layer}: {json.dumps(val, ensure_ascii=False)}")

    # pipeline_results — layers 요약만
    pr = r.get("pipeline_results") or {}
    layers = pr.get("layers", pr)
    print(f"\n  [pipeline_results.layers 요약]")
    if not layers:
        print("    (없음 — pipeline_results 컬럼 NULL)")
    else:
        for layer_name in ("syntax", "stats", "rag", "quality"):
            ld = layers.get(layer_name)
            if ld is None:
                print(f"    {layer_name}: NULL")
                continue
            summary = ld.get("summary", {}) if isinstance(ld, dict) else {}
            if layer_name == "syntax":
                print(f"    syntax : total={ld.get('total')}  valid={ld.get('valid')}  pass_rate={ld.get('pass_rate')}")
            elif layer_name == "stats":
                print(f"    stats  : integrated_score={ld.get('integrated_score')}  diversity={ld.get('diversity')}")
            elif layer_name == "rag":
                print(f"    rag    : evaluated_count={ld.get('evaluated_count')}  summary={json.dumps(summary, ensure_ascii=False)}")
            elif layer_name == "quality":
                print(f"    quality: pass_count={ld.get('pass_count')}  pass_rate={ld.get('pass_rate')}  summary={json.dumps(summary, ensure_ascii=False)}")

print(f"\n{'─'*60}")
print("  점검 완료")
print(f"{'─'*60}\n")
