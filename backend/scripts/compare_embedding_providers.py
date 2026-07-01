"""
Compare Gemini and OpenAI embedding providers on a small retrieval sanity set.

Run:
    python backend/scripts/compare_embedding_providers.py

Optional:
    python backend/scripts/compare_embedding_providers.py --provider google
    python backend/scripts/compare_embedding_providers.py --provider openai
    python backend/scripts/compare_embedding_providers.py --cases-file path/to/cases.json

The script never prints raw API keys. It prints short sha256 key IDs only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Literal

ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DIMENSIONS = 1536


DEFAULT_CASES: list[dict[str, str]] = [
    {
        "name": "copyright_training_data",
        "query": "AI model training data copyright issue",
        "positive": "Generative AI training datasets can raise copyright issues when copyrighted works are collected or copied without permission.",
        "negative": "Supabase stores PostgreSQL rows and provides APIs for inserting, selecting, and updating database records.",
    },
    {
        "name": "privacy_pseudonymization",
        "query": "What is pseudonymization in personal information protection?",
        "positive": "Pseudonymization processes personal information so that a specific individual cannot be identified without additional information.",
        "negative": "A vector database uses approximate nearest neighbor indexes such as HNSW to search embeddings quickly.",
    },
    {
        "name": "korean_ramen_exports",
        "query": "2023 ramen export growth and record high performance",
        "positive": "In 2023, ramen exports reached a record high and continued several years of export growth.",
        "negative": "CORS origins must include the deployed frontend URL when a browser calls a backend API.",
    },
    {
        "name": "ingestion_quota",
        "query": "Gemini embedding quota exceeded during document ingestion",
        "positive": "The ingestion pipeline failed at the embedding stage because the embedding API returned a quota or rate limit error.",
        "negative": "A QA generation prompt should include context, intent distribution, and output JSON schema constraints.",
    },
    {
        "name": "hierarchy_tagging",
        "query": "H1 H2 H3 hierarchy tagging for document chunks",
        "positive": "Document chunks can be tagged with H1, H2, and H3 hierarchy metadata for filtered QA generation.",
        "negative": "OpenAI chat completions return generated text from messages containing system and user prompts.",
    },
]


Provider = Literal["google", "openai"]


@dataclass
class EmbeddingResult:
    provider: Provider
    model: str
    dimensions: int
    vectors: list[list[float]]
    elapsed_ms: float
    request_count: int


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'").split("#", 1)[0].strip()
        if key and value and not os.getenv(key):
            os.environ[key] = value


def load_env() -> None:
    load_env_file(ROOT_DIR / ".env")
    load_env_file(ROOT_DIR / "backend" / ".env")


def secret_id(value: str | None) -> str:
    if not value:
        return "<missing>"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:10]


def l2_normalize(vector: Iterable[float]) -> list[float]:
    values = [float(v) for v in vector]
    norm = math.sqrt(sum(v * v for v in values))
    if norm == 0:
        return values
    return [v / norm for v in values]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def load_cases(path: str | None) -> list[dict[str, str]]:
    if not path:
        return DEFAULT_CASES
    data = json.loads(Path(path).read_text())
    if not isinstance(data, list):
        raise ValueError("cases file must contain a JSON list")
    required = {"name", "query", "positive", "negative"}
    for idx, item in enumerate(data):
        if not isinstance(item, dict) or not required.issubset(item):
            raise ValueError(f"case #{idx} must contain: {sorted(required)}")
    return data


def _row_label(row: dict[str, Any]) -> str:
    meta = row.get("metadata") or {}
    filename = meta.get("filename") or "unknown"
    chunk_index = meta.get("chunk_index")
    row_id = str(row.get("id") or "")[:8]
    if chunk_index is not None:
        return f"{filename}#{chunk_index}:{row_id}"
    return f"{filename}:{row_id}"


def _query_from_metadata(row: dict[str, Any]) -> str:
    meta = row.get("metadata") or {}
    parts = [
        meta.get("hierarchy_h1"),
        meta.get("hierarchy_h2"),
        meta.get("hierarchy_h3"),
        meta.get("section_title"),
    ]
    query = " / ".join(str(p).strip() for p in parts if p and str(p).strip())
    if query:
        return query
    content = " ".join((row.get("content") or "").split())
    return content[:180]


def _truncate_doc(text: str, max_chars: int) -> str:
    text = " ".join((text or "").split())
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def fetch_db_rows(filename: str | None, limit: int, min_chars: int) -> list[dict[str, Any]]:
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_API_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_API_KEY/SUPABASE_KEY are required for --db-cases")

    client = create_client(url, key)
    query = client.table("doc_chunks").select("id, content, metadata, document_id").limit(limit)
    if filename:
        query = query.eq("metadata->>filename", filename)
    rows = query.execute().data or []
    return [
        row
        for row in rows
        if len(" ".join((row.get("content") or "").split())) >= min_chars
    ]


def db_cases(filename: str | None, count: int, pool_limit: int, min_chars: int, max_doc_chars: int) -> list[dict[str, str]]:
    rows = fetch_db_rows(filename, pool_limit, min_chars)
    if len(rows) < 2:
        raise RuntimeError(f"Need at least 2 DB chunks after filtering, got {len(rows)}")

    rng = random.Random(260629)
    rng.shuffle(rows)
    selected = rows[: min(count, len(rows))]
    cases: list[dict[str, str]] = []

    for row in selected:
        meta = row.get("metadata") or {}
        doc_key = row.get("document_id") or meta.get("filename")
        negative_candidates = [
            candidate
            for candidate in rows
            if candidate.get("id") != row.get("id")
            and ((candidate.get("document_id") or (candidate.get("metadata") or {}).get("filename")) != doc_key)
        ]
        if not negative_candidates:
            negative_candidates = [candidate for candidate in rows if candidate.get("id") != row.get("id")]
        negative = rng.choice(negative_candidates)
        cases.append({
            "name": _row_label(row),
            "query": _query_from_metadata(row),
            "positive": _truncate_doc(row.get("content") or "", max_doc_chars),
            "negative": _truncate_doc(negative.get("content") or "", max_doc_chars),
        })

    return cases


def flatten_cases(cases: list[dict[str, str]]) -> list[str]:
    texts: list[str] = []
    for case in cases:
        texts.extend([case["query"], case["positive"], case["negative"]])
    return texts


def google_input(text: str, kind: str) -> str:
    if kind == "query":
        return f"task: search result\nquery: {text}"
    return f"text: {text}"


async def embed_google(texts: list[str], kinds: list[str], model: str, dimensions: int) -> EmbeddingResult:
    from google import genai as google_genai

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")

    client = google_genai.Client(api_key=api_key)
    vectors: list[list[float]] = []
    started = time.perf_counter()
    for text, kind in zip(texts, kinds):
        if model == "gemini-embedding-2":
            contents = google_input(text, kind)
            config = google_genai.types.EmbedContentConfig(output_dimensionality=dimensions)
        else:
            contents = text
            config = google_genai.types.EmbedContentConfig(
                task_type="RETRIEVAL_QUERY" if kind == "query" else "RETRIEVAL_DOCUMENT",
                output_dimensionality=dimensions,
            )
        res = await client.aio.models.embed_content(model=model, contents=contents, config=config)
        vectors.append(l2_normalize(res.embeddings[0].values))
    elapsed_ms = (time.perf_counter() - started) * 1000
    return EmbeddingResult("google", model, dimensions, vectors, elapsed_ms, len(texts))


def embed_openai(texts: list[str], model: str, dimensions: int) -> EmbeddingResult:
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    client = OpenAI(api_key=api_key)
    started = time.perf_counter()
    response = client.embeddings.create(model=model, input=texts, dimensions=dimensions)
    vectors = [l2_normalize(item.embedding) for item in response.data]
    elapsed_ms = (time.perf_counter() - started) * 1000
    return EmbeddingResult("openai", model, dimensions, vectors, elapsed_ms, 1)


def kinds_for_cases(cases: list[dict[str, str]]) -> list[str]:
    kinds: list[str] = []
    for _case in cases:
        kinds.extend(["query", "document", "document"])
    return kinds


def evaluate(result: EmbeddingResult, cases: list[dict[str, str]]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    hits = 0
    for idx, case in enumerate(cases):
        base = idx * 3
        query_v = result.vectors[base]
        positive_v = result.vectors[base + 1]
        negative_v = result.vectors[base + 2]
        positive_score = cosine(query_v, positive_v)
        negative_score = cosine(query_v, negative_v)
        hit = positive_score > negative_score
        hits += int(hit)
        rows.append({
            "name": case["name"],
            "positive": positive_score,
            "negative": negative_score,
            "margin": positive_score - negative_score,
            "hit": hit,
        })
    return {
        "provider": result.provider,
        "model": result.model,
        "dimensions": result.dimensions,
        "elapsed_ms": result.elapsed_ms,
        "request_count": result.request_count,
        "hit_rate": hits / max(len(cases), 1),
        "rows": rows,
    }


def print_summary(summary: dict[str, Any]) -> None:
    print(f"\n[{summary['provider']}] {summary['model']}")
    print(f"  dimensions:    {summary['dimensions']}")
    print(f"  requests:      {summary['request_count']}")
    print(f"  elapsed_ms:    {summary['elapsed_ms']:.1f}")
    print(f"  hit_rate:      {summary['hit_rate'] * 100:.1f}%")
    print("  cases:")
    for row in summary["rows"]:
        mark = "PASS" if row["hit"] else "FAIL"
        print(
            f"    - {mark} {row['name']}: "
            f"pos={row['positive']:.4f}, neg={row['negative']:.4f}, margin={row['margin']:.4f}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare Gemini and OpenAI embedding providers.")
    parser.add_argument("--provider", choices=["both", "google", "openai"], default="both")
    parser.add_argument("--google-model", default=os.getenv("GOOGLE_EMBED_MODEL", "gemini-embedding-2"))
    parser.add_argument("--openai-model", default=os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small"))
    parser.add_argument("--dimensions", type=int, default=int(os.getenv("EMBED_DIMENSIONS", DEFAULT_DIMENSIONS)))
    parser.add_argument("--cases-file", help="JSON list with name/query/positive/negative fields")
    parser.add_argument("--db-cases", type=int, default=0, help="Build cases from Supabase doc_chunks")
    parser.add_argument("--db-filename", help="Restrict --db-cases to one filename")
    parser.add_argument("--db-pool-limit", type=int, default=500, help="Max DB chunks to sample before building cases")
    parser.add_argument("--db-min-chars", type=int, default=120, help="Minimum chunk content length for DB cases")
    parser.add_argument("--max-doc-chars", type=int, default=2400, help="Max positive/negative chars embedded per DB case")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON only")
    return parser.parse_args()


async def main() -> int:
    load_env()
    args = parse_args()
    if args.db_cases:
        cases = db_cases(
            filename=args.db_filename,
            count=args.db_cases,
            pool_limit=args.db_pool_limit,
            min_chars=args.db_min_chars,
            max_doc_chars=args.max_doc_chars,
        )
    else:
        cases = load_cases(args.cases_file)
    texts = flatten_cases(cases)
    kinds = kinds_for_cases(cases)
    summaries: list[dict[str, Any]] = []

    if not args.json:
        print("Embedding provider comparison")
        print(f"  cases:         {len(cases)}")
        print(f"  dimensions:    {args.dimensions}")
        print(f"  GOOGLE key_id: {secret_id(os.getenv('GOOGLE_API_KEY'))}")
        print(f"  OPENAI key_id: {secret_id(os.getenv('OPENAI_API_KEY'))}")

    if args.provider in ("both", "google"):
        google_result = await embed_google(texts, kinds, args.google_model, args.dimensions)
        summaries.append(evaluate(google_result, cases))

    if args.provider in ("both", "openai"):
        openai_result = embed_openai(texts, args.openai_model, args.dimensions)
        summaries.append(evaluate(openai_result, cases))

    if args.json:
        print(json.dumps({"cases": len(cases), "summaries": summaries}, ensure_ascii=False, indent=2))
    else:
        for summary in summaries:
            print_summary(summary)

    return 0


if __name__ == "__main__":
    try:
        import asyncio

        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        raise SystemExit(130)
