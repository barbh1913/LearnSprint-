# LearnSprint

Exam-prep study planner. See [CLAUDE.md](CLAUDE.md) for the full specification, [ABOUT.md](ABOUT.md) for project context, [docs/erd.md](docs/erd.md) for the data model, [docs/adr/](docs/adr/) for architecture decisions, and [docs/diagrams/](docs/diagrams/) for the target AWS architecture.

Local development runs entirely without AWS — see [ADR 0003](docs/adr/0003-local-first-then-incremental-aws.md).

## Prerequisites

- Python 3.11+
- Node.js 20+
- Docker (for local PostgreSQL)

## 1. Start the database

```
docker compose up -d
```

Postgres is available at `localhost:5432` (user/password/db: `study_planner`).

## 2. Run the backend

```
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -e ".[dev]"
alembic upgrade head
uvicorn main:app --app-dir src --reload --port 8000
```

Backend runs at `http://localhost:8000` (`/health` for a liveness check, `/docs` for the OpenAPI UI).

Run tests: `pytest` (from `backend/`).

## 3. Run the frontend

```
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and proxies `/api/*` to the backend at `http://localhost:8000/*` (see `vite.config.ts`).

Run tests: `npm run test` (from `frontend/`).

## Project structure

```
backend/   Python + FastAPI, Clean Architecture per business feature
frontend/  React + TypeScript + Vite
docs/      Specification companions: ERD, ADRs, diagrams
```
