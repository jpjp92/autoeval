"""
대시보드 집계 데이터 조회
"""

import logging
from typing import Dict, Any

from .base_client import supabase

logger = logging.getLogger("autoeval.db")


async def get_dashboard_metrics() -> Dict[str, Any]:
    """Dashboard 요약 데이터 조회"""
    if not supabase:
        return {}

    try:
        # 1) qa_gen_results
        gen_res = supabase.table("qa_gen_results").select(
            "id, job_id, source_doc, metadata, stats, created_at, linked_evaluation_id"
        ).order("created_at", desc=True).execute()
        gen_rows = gen_res.data or []

        # 2) qa_eval_results
        eval_res = supabase.table("qa_eval_results").select(
            "id, job_id, metadata, total_qa, valid_qa, final_score, final_grade, created_at"
        ).order("created_at", desc=True).execute()
        eval_rows = eval_res.data or []

        # 3) doc_chunks distinct filename 수
        chunks_res = supabase.table("doc_chunks").select("metadata").execute()
        doc_names = set()
        for c in chunks_res.data or []:
            fn = (c.get("metadata") or {}).get("filename")
            if fn:
                doc_names.add(fn)

        # --- summary ---
        total_qa = sum((g.get("stats") or {}).get("total_qa", 0) for g in gen_rows)

        scores = [e["final_score"] for e in eval_rows if e.get("final_score") is not None]
        avg_score = round(sum(scores) / len(scores), 3) if scores else 0.0
        high_grade = sum(1 for e in eval_rows if e.get("final_grade") in ("A+", "A"))
        pass_rate = round(high_grade / len(eval_rows) * 100, 1) if eval_rows else 0.0

        summary = {
            "total_qa": total_qa,
            "avg_final_score": avg_score,
            "pass_rate": pass_rate,
            "total_documents": len(doc_names),
            "total_evaluations": len(eval_rows),
        }

        # --- recent_jobs (최근 10건, 생성 job 기준) ---
        # 1차: linked_evaluation_id FK 기준
        eval_map = {e["id"]: e for e in eval_rows if e.get("id")}
        # 2차 폴백: eval.metadata.generation_id == gen.id (FK 미설정 레코드 보완)
        eval_map_by_gen_id = {
            (e.get("metadata") or {}).get("generation_id"): e
            for e in eval_rows
            if (e.get("metadata") or {}).get("generation_id")
        }

        recent_jobs = []
        for g in gen_rows[:10]:
            meta = g.get("metadata") or {}
            st = g.get("stats") or {}
            linked_id = g.get("linked_evaluation_id")
            linked_eval = (
                eval_map.get(linked_id)
                if linked_id
                else eval_map_by_gen_id.get(g.get("id"))
            )
            recent_jobs.append({
                "job_id": g.get("job_id", ""),
                "source_doc": g.get("source_doc") or meta.get("source_doc", ""),
                "model": meta.get("generation_model", ""),
                "total_qa": st.get("total_qa", 0),
                "eval_id":     linked_eval.get("id")          if linked_eval else None,
                "eval_job_id": linked_eval.get("job_id")      if linked_eval else None,
                "eval_score":  linked_eval.get("final_score") if linked_eval else None,
                "eval_grade":  linked_eval.get("final_grade") if linked_eval else None,
                "created_at": g.get("created_at", ""),
            })

        # --- grade_distribution ---
        grade_dist: Dict[str, int] = {"A+": 0, "A": 0, "B+": 0, "B": 0, "C": 0, "F": 0}
        for e in eval_rows:
            grade = e.get("final_grade", "")
            if grade in grade_dist:
                grade_dist[grade] += 1

        # --- score_trend ---
        score_trend = [
            {
                "date": e.get("created_at", ""),
                "score": e.get("final_score"),
                "grade": e.get("final_grade", ""),
                "doc": (e.get("metadata") or {}).get("source_doc", ""),
            }
            for e in reversed(eval_rows)
        ]

        return {
            "summary": summary,
            "recent_jobs": recent_jobs,
            "grade_distribution": grade_dist,
            "score_trend": score_trend,
        }

    except Exception as e:
        logger.error(f"❌ Failed to get dashboard metrics: {e}")
        return {"error": str(e)}
