# 0001 — Python + FastAPI backend

> **Partly superseded by [0006](0006-dynamodb-single-table.md).** The Python/FastAPI choice stands; the SQLAlchemy + RDS persistence choice was replaced by DynamoDB.

## Context

The project was originally specified as TypeScript across the full stack (see CLAUDE.md's first draft of the "Tech stack" section). Bar decided to deploy the system on AWS with a physically separated frontend and backend, and specified a Python/FastAPI backend as part of that architecture.

## Decision

The backend is Python + FastAPI, with Pydantic for schemas, SQLAlchemy for the ORM, and Alembic for migrations. The frontend stays React + TypeScript.

## Alternatives considered

- **TypeScript backend (e.g. NestJS)**: keeps one language across the stack, which was the original plan. Rejected because Bar wants the Python/FastAPI/AWS-serverless combination specifically, and Python has mature, well-known tooling for the FR2 text-extraction work (PDF/PPTX parsing).

## Consequences

- Domain/Application types are now defined twice — as Python types on the backend and TypeScript types on the frontend — kept in sync manually via the shared Data Dictionary in CLAUDE.md, not via a generated shared package (not worth the tooling for a two-person-at-most project).
- CLAUDE.md's "Tech stack" section and the `study-planner-dev` agent's non-negotiables were both updated to match, so the spec and the code don't drift.
