# LearnSprint

Plan your studying as a weekly sprint: commit to a set of material, and know upfront whether it actually fits the hours you have.

Upload your course material and LearnSprint works out the topics and how long each takes to learn. Pull topics into this week's sprint and it tells you immediately whether that commitment fits your real free hours — after work and lectures, not in theory. As the exam approaches it builds a study plan that gives the topics you rated weakest the most review time.

**Live**: **[d6dbklbpa5amn.cloudfront.net](https://d6dbklbpa5amn.cloudfront.net)** — sign up with any email, or continue with Google. See [ADR 0008](docs/adr/0008-deployed-to-aws.md) for how it's deployed.

## Documentation

| Document | What's in it |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Full specification — product thesis, functional requirements, data dictionary, edge cases |
| [docs/use-cases.md](docs/use-cases.md) | Use cases UC1–UC12 |
| [docs/erd.md](docs/erd.md) | Data model (DynamoDB single-table design) |
| [docs/adr/](docs/adr/) | Architecture decisions and the reasoning behind them |
| [docs/diagrams/](docs/diagrams/) | System architecture, request flow, algorithm sequence |
| [ABOUT.md](ABOUT.md) | Project context |

## Prerequisites

- Python 3.11+
- Node.js 20+
- An AWS account with a DynamoDB table (created below)

There is no local database to install — no Docker, no Postgres. The backend talks to DynamoDB directly, which on on-demand billing costs approximately nothing at development scale.

## 1. Create the DynamoDB table

One table holds everything — see [docs/erd.md](docs/erd.md) for the key design:

```
aws dynamodb create-table --table-name LearnSprint --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
                          AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes "IndexName=GSI1,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}"
```

Then configure your AWS credentials (`aws configure`).

## 2. Run the backend

```
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -e ".[dev]"
uvicorn main:app --app-dir src --reload --port 8000
```

Backend runs at `http://localhost:8000` — `/health` for a liveness check, `/docs` for the interactive API documentation.

Environment variables (all optional, defaults shown):

| Variable | Default | Purpose |
|---|---|---|
| `DYNAMO_TABLE` | `LearnSprint` | Table name |
| `AWS_REGION` | `il-central-1` | Region the table lives in |
| `JWT_SECRET` | `dev-secret-change-me` | Signs auth tokens — **set a real value outside local development** |
| `COGNITO_USER_POOL_ID` | *(empty)* | Enables Google sign-in — see step 4 |
| `COGNITO_CLIENT_ID` | *(empty)* | Enables Google sign-in — see step 4 |
| `COGNITO_REGION` | `il-central-1` | Region of the user pool |

Run the tests: `pytest` (from `backend/`). They run against an in-memory stand-in for DynamoDB, so they work offline and leave nothing behind in AWS.

## 3. Run the frontend

```
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and proxies `/api/*` to the backend (see `vite.config.ts`).

Run the tests: `npm run test` (from `frontend/`).

## 4. Optional: Google sign-in

The login page shows **Continue with Google** when Cognito is configured. Copy `frontend/.env.example` to `frontend/.env.local` and fill in the pool's hosted-UI domain, app client id and callback URL; give the backend the pool id and client id in `backend/.env` (see `backend/.env.example`). Restart both servers — they read these at startup.

The user pool needs Google as an identity provider and `http://localhost:5173/callback` as an allowed callback URL. Without any of this the button is simply hidden and email/password works as before. How the two logins share one account is in [ADR 0007](docs/adr/0007-google-sign-in-via-cognito.md).

## 5. Optional: enable AI analysis

When the backend has `SYSTEM_ANTHROPIC_API_KEY` set (see `backend/.env.example`), Claude reads uploaded material: the batch upload gets real per-topic time estimates, "Analyse one file" gets a summary, key points and a recommendation of which topic the file belongs to, and "Analyse a syllabus" proposes one topic per lecture for review. Without the key, a built-in keyword heuristic does the same jobs more roughly. The matching itself is always LearnSprint's own explainable logic, never an AI decision (ADR 0013).

The key is stored against your own account, never returned to the browser, and never logged. If the AI call fails for any reason the heuristic runs instead, so an upload never fails because of it.

## Project structure

```
backend/
  src/
    features/             One module per business capability, each internally layered
      academic_profile/     Courses, grades, time constraints         (FR1)
      content_topics/       Material upload, topic extraction, AI     (FR2)
      scheduling/           Mastery-weighted allocation algorithm     (FR3)
      progress/             Sprint planning, board, velocity     (FR4, FR7)
      study_groups/         Shared courses, peer progress         (FR5)
    shared/               Auth, DynamoDB access, config
  tests/
frontend/
  src/
    pages/                One per route
    components/           Shared UI
    api/                  Typed API client
docs/                     Specification companions
```

Every feature module keeps the same internal layering — `domain/` (pure business logic, no I/O), `application/` (use cases), `infrastructure/` (DynamoDB, file parsing, AI), `presentation/` (HTTP routes). See [ADR 0004](docs/adr/0004-feature-based-backend-organization.md).
