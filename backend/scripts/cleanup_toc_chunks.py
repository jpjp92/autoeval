import asyncio
import os
import sys

# 프로젝트 루트 경로 추가 (패키지 임포트용)
ROOT_DIR = "/home/jpjp92/devs/works/autoeval"
sys.path.append(ROOT_DIR)

def load_env():
    try:
        with open(os.path.join(ROOT_DIR, ".env"), "r") as f:
            for line in f:
                if line.strip() and not line.startswith("#"):
                    parts = line.strip().split("=", 1)
                    if len(parts) == 2:
                        key, value = parts
                        os.environ[key] = value.strip('"').strip("'").split("#")[0].strip()
    except Exception as e:
        print(f"Error loading .env: {e}")

load_env()

from backend.config.supabase_client import supabase_client

def is_toc_chunk(text: str) -> bool:
    """ingestion_api.py의 로직과 동일"""
    if not text:
        return False
    
    dot_count = text.count('.')
    special_dot_count = text.count('·')
    
    if special_dot_count > 20: 
        return True
    if dot_count > 50:
        return True
    
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    if not lines:
        return False
        
    toc_lines = 0
    for line in lines:
        if (line.count('·') > 5 or line.count('.') > 5) and any(c.isdigit() for c in line[-5:]):
            toc_lines += 1
            
    if toc_lines / len(lines) > 0.5:
        return True
    return False

async def cleanup(dry_run=True):
    if not supabase_client:
        print("Supabase client not initialized.")
        return

    print(f"--- TOC Cleanup Start (Dry Run: {dry_run}) ---")
    
    # 전체 청크 순회 (실제 운영 환경에서는 페이지네이션 필요하지만 여기서는 최근 1000개 정도만 확인)
    limit = 1000
    response = supabase_client.table("doc_chunks").select("id, content").order("created_at", desc=True).limit(limit).execute()
    
    if not response.data:
        print("No chunks found.")
        return

    toc_ids = []
    for chunk in response.data:
        if is_toc_chunk(chunk["content"]):
            toc_ids.append(chunk["id"])
            print(f"[MATCH] TOC Target: {chunk['id']} | Preview: {chunk['content'][:50].replace('\\n', ' ')}...")

    print(f"\nFound {len(toc_ids)} TOC-like chunks out of {len(response.data)} checked.")

    if not dry_run and toc_ids:
        print(f"Deleting {len(toc_ids)} chunks...")
        for chunk_id in toc_ids:
            supabase_client.table("doc_chunks").delete().eq("id", chunk_id).execute()
        print("Deletion complete.")
    elif toc_ids:
        print("Dry run complete. Use dry_run=False to actually delete.")

if __name__ == "__main__":
    # 안전을 위해 기본 dry_run=True
    asyncio.run(cleanup(dry_run=False))
