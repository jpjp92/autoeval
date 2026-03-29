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

        # --- model_benchmarks (생성 모델별 누적 성능 집계) ---
        # qa_eval_results.metadata 에 generation_model이 직접 저장됨 (pipeline.py L685)
        # → gen 테이블과의 크로스 조인 불필요, eval row만으로 집계 가능
        model_stats: dict[str, dict] = {}
        gen_by_id = {g["id"]: g for g in gen_rows if g.get("id")}
        gen_id_by_eval_id = {g.get("linked_evaluation_id"): g.get("id") for g in gen_rows if g.get("linked_evaluation_id")}

        for e in eval_rows:
            # 1차: eval.metadata.generation_model (pipeline.py가 직접 저장)
            gen_model = (e.get("metadata") or {}).get("generation_model", "")
            # 2차 폴백: linked gen row 에서 조회
            if not gen_model:
                eval_id = e.get("id", "")
                gen_id = gen_id_by_eval_id.get(eval_id)
                if gen_id:
                    gen = gen_by_id.get(gen_id)
                    if gen:
                        gen_model = (gen.get("metadata") or {}).get("generation_model", "")
            if not gen_model:
                continue

            if gen_model not in model_stats:
                model_stats[gen_model] = {"scores": [], "valid_qa": 0, "total_qa": 0, "count": 0}

            if e.get("final_score") is not None:
                model_stats[gen_model]["scores"].append(e["final_score"])
            model_stats[gen_model]["valid_qa"]  += e.get("valid_qa", 0) or 0
            model_stats[gen_model]["total_qa"]  += e.get("total_qa", 0) or 0
            model_stats[gen_model]["count"]     += 1

        model_benchmarks = []
        for model_name, stats in model_stats.items():
            avg_score = round(sum(stats["scores"]) / len(stats["scores"]), 3) if stats["scores"] else 0.0
            pass_rate = round(stats["valid_qa"] / stats["total_qa"] * 100, 1) if stats["total_qa"] > 0 else 0.0
            model_benchmarks.append({
                "model":      model_name,
                "avg_score":  avg_score,
                "pass_rate":  pass_rate,
                "run_count":  stats["count"],
                "total_qa":   stats["total_qa"],
                "valid_qa":   stats["valid_qa"],
            })

        # 평균 점수 내림차순 정렬
        model_benchmarks.sort(key=lambda x: x["avg_score"], reverse=True)

        return {
            "summary": summary,
            "recent_jobs": recent_jobs,
            "grade_distribution": grade_dist,
            "score_trend": score_trend,
            "model_benchmarks": model_benchmarks,
        }

    except Exception as e:
        logger.error(f"Failed to get dashboard metrics: {e}")
        return {"error": str(e)}
