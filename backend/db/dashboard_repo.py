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
            "id, job_id, source_doc, metadata, stats, created_at"
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

        # --- recent_jobs (최근 10건) ---
        recent_jobs = []
        for g in gen_rows[:10]:
            meta = g.get("metadata") or {}
            st = g.get("stats") or {}
            recent_jobs.append({
                "job_id": g.get("job_id", ""),
                "type": "generation",
                "source_doc": g.get("source_doc") or meta.get("source_doc", ""),
                "model": meta.get("generation_model", ""),
                "total_qa": st.get("total_qa", 0),
                "created_at": g.get("created_at", ""),
            })
        for e in eval_rows[:10]:
            meta = e.get("metadata") or {}
            recent_jobs.append({
                "job_id": e.get("job_id", ""),
                "type": "evaluation",
                "source_doc": meta.get("source_doc", ""),
                "model": meta.get("evaluator_model", ""),
                "total_qa": e.get("total_qa", 0),
                "final_score": e.get("final_score"),
                "final_grade": e.get("final_grade", ""),
                "created_at": e.get("created_at", ""),
            })
        recent_jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        recent_jobs = recent_jobs[:10]

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
