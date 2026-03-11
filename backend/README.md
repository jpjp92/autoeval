# Auto Evaluation Backend API

FastAPI-based backend for the Auto Evaluation Dashboard.

## Features

- ✅ **QA Generation**: Start QA generation jobs with various models (Flashlite, GPT-5.1, GPT-4o, Claude)
- ✅ **Evaluation**: Run quality evaluation on generated QA sets
- ✅ **Results Management**: List, retrieve, and manage evaluation results
- ✅ **Export**: Export results in multiple formats (CSV, HTML, XLSX, JSON)
- ✅ **Streaming**: SSE support for real-time progress updates
- ✅ **CORS**: Configured for frontend communication

## Setup

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Run Server

```bash
python main.py
```

Server will start at `http://localhost:8000`

API Documentation: `http://localhost:8000/docs`

## API Endpoints

### Results Management

- `GET /api/results` - List all evaluation results
- `GET /api/results/{filename}` - Get specific result details
- `POST /api/export` - Export results in specified format

### QA Generation

- `POST /api/generate` - Start QA generation job
- Model options: `flashlite`, `gpt-5.1`, `gpt-4o`, `claude-sonnet`
- Language options: `ko`, `en`

### Evaluation

- `POST /api/evaluate` - Start evaluation job
- Supports Layer 1 (Dataset Stats) and Layer 2 (Quality Scores)

### System

- `GET /health` - Health check
- `GET /api/config` - Get system configuration
- `GET /api/status` - Get system status

## Project Structure

```
backend/
├── main.py              # FastAPI application
├── requirements.txt     # Python dependencies
├── .env.example        # Environment configuration template
└── routers/            # (Future) Modularized API routes
    ├── results.py
    ├── generation.py
    ├── evaluation.py
    └── export.py
```

## Integration Points

### With main.py (QA Generation)
```python
from pathlib import Path
import subprocess

# Call main.py for generation
result = subprocess.run([
    "python", "../main.py",
    "--model", "flashlite",
    "--lang", "ko",
    "--samples", "10",
    "--qa-per-doc", "5"
])
```

### With qa_quality_evaluator.py (Evaluation)
```python
from pathlib import Path
import sys
sys.path.append(str(Path(__file__).parent.parent))

from qa_quality_evaluator import QualityEvaluator, DatasetStats

evaluator = QualityEvaluator()
# Run evaluations
```

## Development

### Enable Logging

All requests and errors are logged to console (configurable level in .env)

### CORS Configuration

Edit `CORS_ORIGINS` in `.env` to allow specific frontends:

```
CORS_ORIGINS=http://localhost:3000,https://yourdomain.vercel.app
```

### Database (Future)

Connect to SQLite/PostgreSQL for persistent job tracking:

```python
# TODO: Add SQLAlchemy models
# - Job status tracking
# - Result metadata
# - User sessions
```

## Deployment

### Render.com

```bash
# requirements.txt is already set up
# Set environment variables in Render dashboard
# Deploy from git
```

### Railway.app

```bash
# Deploy from git, Railway auto-detects Python
# Configure secrets in Railway dashboard
```

### Docker (Future)

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Testing

```bash
# Start server
python main.py

# In another terminal, test endpoints
curl http://localhost:8000/health
curl http://localhost:8000/api/status
curl http://localhost:8000/api/results
```

## Notes

- All file paths are relative to the project root
- Output files are saved in `../output/`
- Evaluation results are saved in `../validated_output/`
- Streaming endpoints use Server-Sent Events (SSE) in production
