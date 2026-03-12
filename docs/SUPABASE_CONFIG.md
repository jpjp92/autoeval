# Supabase Environment Configuration

## Backend (.env)

```bash
# ========================
# 🗄️ Supabase Configuration
# ========================

# Supabase API credentials
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_KEY=your-supabase-service-role-key

# Database
DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/postgres

# ========================
# 🤖 LLM API Keys (기존)
# ========================

GEMINI_API_KEY=your-gemini-api-key
CLAUDE_API_KEY=your-claude-api-key
OPENAI_API_KEY=your-openai-api-key

# ========================
# 🔧 Application Settings
# ========================

LOG_LEVEL=INFO
OUTPUT_DIR=./output
VALIDATED_OUTPUT_DIR=./validated_output
```

## Frontend (.env.local)

```bash
# ========================
# 🗄️ Supabase Configuration
# ========================

# Anon key 사용 (클라이언트)
REACT_APP_SUPABASE_URL=https://your-project-ref.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-supabase-anon-key

# ========================
# 🔧 Application Settings
# ========================

REACT_APP_API_BASE_URL=http://localhost:8000/api
REACT_APP_LOG_LEVEL=debug
```

## Supabase Project Setup

### 1. Supabase 프로젝트 생성

1. https://supabase.com 방문
2. "New Project" 클릭
3. 프로젝트명: "autoeval"
4. Database password 설정 (강력한 비밀번호 필수)
5. 리전: 가장 가까운 지역 선택

### 2. API Keys 획득

1. Supabase 대시보드 → "Project Settings"
2. "API" 탭에서:
   - `SUPABASE_URL` 복사
   - Anon Key: `REACT_APP_SUPABASE_ANON_KEY`
   - Service Role Key: `SUPABASE_SERVICE_KEY` (백엔드)

### 3. SQL 스키마 생성

1. Supabase → SQL Editor
2. `docs/SUPABASE_SCHEMA.sql` 전체 복사
3. SQL Editor에 붙여넣고 실행

### 4. 확인

```sql
-- SQL Editor에서 실행
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- 결과 확인:
-- evaluation_results
-- qa_generation_results
```

---

## Environment Variables Reference

### Backend

| 변수 | 설명 | 예시 |
|------|------|------|
| `SUPABASE_URL` | Supabase API URL | `https://abc123.supabase.co` |
| `SUPABASE_KEY` | Anon Key (읽기) | `eyJhbGc...` |
| `SUPABASE_SERVICE_KEY` | Service Role Key (모든 권한) | `eyJhbGc...` |
| `GEMINI_API_KEY` | Google Gemini API | `AIza...` |
| `CLAUDE_API_KEY` | Anthropic Claude | `sk-ant-...` |
| `OPENAI_API_KEY` | OpenAI | `sk-...` |
| `LOG_LEVEL` | 로그 레벨 | `INFO`, `DEBUG` |

### Frontend

| 변수 | 설명 | 예시 |
|------|------|------|
| `REACT_APP_SUPABASE_URL` | Supabase API URL | `https://abc123.supabase.co` |
| `REACT_APP_SUPABASE_ANON_KEY` | Anon Key (읽기) | `eyJhbGc...` |
| `REACT_APP_API_BASE_URL` | Backend API URL | `http://localhost:8000/api` |

---

## 로컬 개발 환경 설정

### Backend 준비

```bash
# 프로젝트 루트에서

# 1. Python 환경 설정
python -m venv .venv
source .venv/bin/activate

# 2. 의존성 설치
pip install supabase python-dotenv

# 3. .env 파일 생성
cp .env.example .env

# 4. .env 에디터
# SUPABASE_URL, SUPABASE_KEY 입력

# 5. 테스트
python3 -c "from supabase import create_client; print('✓ Supabase OK')"
```

### Frontend 준비

```bash
# frontend 폴더에서

# 1. .env.local 생성
cp .env.example .env.local

# 2. .env.local 에디터
# REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY 입력

# 3. 의존성 설치
npm install @supabase/supabase-js

# 4. 테스트
npm run dev
```

---

## 보안 체크리스트

- [ ] Service Role Key는 서버환경변수만 사용
- [ ] Anon Key는 public한 클라이언트에서 사용 가능 (RLS로 보호됨)
- [ ] .env 파일은 .gitignore에 포함
- [ ] Supabase 대시보드에서 RLS Policies 확인
- [ ] 프로덕션: 환경변수는 GitHub Secrets / 배포 플랫폼 secrets로 관리

---

## CI/CD Integration (GitHub Actions)

```yaml
# .github/workflows/deploy.yml

name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up environment
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          REACT_APP_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          REACT_APP_SUPABASE_ANON_KEY: ${{ secrets.REACT_APP_SUPABASE_ANON_KEY }}
        run: |
          echo "SUPABASE_URL=$SUPABASE_URL" >> .env
          echo "Environment configured"
      
      - name: Backend tests
        run: |
          pip install -r requirements.txt
          pytest tests/
      
      - name: Frontend build
        run: |
          cd frontend
          npm ci
          npm run build
```

---

## RLS (Row Level Security) 정책 확인

Supabase 대시보드에서:

1. Authentication → Policies
2. `qa_generation_results` 테이블:
   - SELECT: `true` (모두 읽기)
   - INSERT: `auth.role() = 'authenticated'` (인증된 사용자)
3. `evaluation_results` 테이블:
   - SELECT: `true` (모두 읽기)
   - INSERT: `auth.role() = 'authenticated'` (인증된 사용자)

---

## 문제 해결

### "Invalid API key" 오류

```
❌ Error: Invalid API key
✅ 해결: SUPABASE_URL, SUPABASE_KEY 확인
```

### "Permission denied" (RLS)

```
❌ Error: permission denied for schema "public"
✅ 해결: Supabase 대시보드 → Policies 확인
        INSERT 정책이 'authenticated' 사용자 포함하는지 확인
```

### 테이블이 보이지 않음

```
✅ 확인: Supabase → Tables
✅ 확인: docs/SUPABASE_SCHEMA.sql 전체 실행했는지 확인
✅ 재실행: SQL Editor에서 CREATE TABLE 다시 실행
```

---

## 유용한 SQL 명령어

```sql
-- 테이블 목록 확인
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';

-- 컬럼 정보 확인
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'evaluation_results';

-- 인덱스 확인
SELECT indexname FROM pg_indexes 
WHERE tablename = 'evaluation_results';

-- row count 확인
SELECT COUNT(*) FROM evaluation_results;
SELECT COUNT(*) FROM qa_generation_results;

-- 최근 데이터 확인
SELECT * FROM evaluation_results 
ORDER BY created_at DESC LIMIT 5;
```

---

## 다음 단계

1. ✅ Supabase 계정 & 프로젝트 생성
2. ✅ SQL 스키마 적용 (SUPABASE_SCHEMA.sql)
3. ✅ API Keys 환경변수 설정
4. ✅ 클라이언트 라이브러리 설치
5. 📋 Backend integration (generation_api.py, evaluation_api.py)
6. 📋 Frontend integration (QAGenerationPanel.tsx)
7. 📋 테스트 & 배포
