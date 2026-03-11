"""
Backend Constants
경로, 상수, 설정값 정의
"""

from pathlib import Path

# 디렉토리 경로
BASE_DIR = Path(__file__).parent.parent.parent  # /autoeval
BACKEND_DIR = Path(__file__).parent.parent      # /autoeval/backend
OUTPUT_DIR = BASE_DIR / "output"
DATA_DIR = BASE_DIR / "ref" / "data"

# 데이터 파일
DATA_FILE = DATA_DIR / "data_2026-03-06_normalized.json"

# 평가 리포트 디렉토리
VALIDATED_OUTPUT_DIR = BASE_DIR / "validated_output"

# 스레드 설정
THREAD_POOL_WORKERS = 4

# 로깅 설정
LOG_LEVEL = "info"
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
