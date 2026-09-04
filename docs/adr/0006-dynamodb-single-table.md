# 0006 — DynamoDB single-table instead of RDS PostgreSQL

Supersedes the persistence decisions in [0001](0001-python-fastapi-backend.md) (SQLAlchemy + Alembic) and [0003](0003-local-first-then-incremental-aws.md) (local Postgres container).

## Context

[0001](0001-python-fastapi-backend.md) chose SQLAlchemy and Alembic against RDS PostgreSQL, and [0003](0003-local-first-then-incremental-aws.md) chose a local Postgres container so development needed no AWS. Three things then changed:

1. **A survey of the existing AWS account** found the infrastructure from a previous project: S3 + CloudFront, API Gateway, three Python Lambdas, a Cognito user pool, and a DynamoDB table — but no RDS anywhere. The established pattern in this account was serverless and DynamoDB.
2. **RDS costs money continuously.** A `db.t4g.micro` runs roughly $15–25/month outside the free tier. DynamoDB on-demand costs effectively nothing at one student's usage.
3. **The local Postgres container turned out not to be available.** Docker wasn't usable on the development machine and a native Postgres install was declined, which left the project with no working local database at all — the choice was no longer "Postgres vs. DynamoDB" but "DynamoDB vs. nothing".

## Decision

All persistence is a single DynamoDB table (`LearnSprint`) with a composite `(PK, SK)` key and one global secondary index. Access goes through `boto3` in a thin `shared/dynamo.py` module. SQLAlchemy, Alembic, `psycopg`, and the `docker-compose.yml` Postgres service were removed.

Development runs against the real DynamoDB table rather than a local emulator. Tests run against an in-memory fake (`tests/conftest.py`) that implements only the four access patterns the code uses, so the suite is offline, fast, and leaves nothing in AWS.

## Alternatives considered

- **Keep RDS PostgreSQL.** The domain is genuinely relational and SQL would express the weighted-average and progress joins more directly. Rejected on cost, on the absence of any usable local database, and because the account's existing pattern was DynamoDB. This was the closest call in the project.
- **DynamoDB Local for development.** The obvious way to keep development offline. Rejected because it runs as a Docker container or a Java process, and Docker was exactly what wasn't available.
- **SQLite locally, DynamoDB in production.** Fast to start, but two persistence implementations to keep in sync, and a whole class of bug that only ever appears in production. Not worth it for one developer.

## Consequences

**Joins move into the application layer.** DynamoDB cannot join, so `board_service.build_board` fetches shared topics and private progress separately and combines them in Python. This is fine at a student's data volume (tens of topics), and it is honest about where the work happens — but it is the real price paid for this decision.

**Aggregations are computed, not queried.** The weighted average and the sprint capacity are Python functions over fetched records rather than SQL. Both are pure functions in the domain layer and directly unit-tested, which is arguably better for the project than a query would have been.

**Some fields are denormalised**, notably course details copied onto each membership record. `update_course` has to refresh those copies. See [docs/erd.md](../erd.md).

**Development requires AWS credentials and a network connection** — a real regression from [0003](0003-local-first-then-incremental-aws.md)'s local-first goal, and worth stating plainly. The test suite deliberately does not share this constraint.

**The Lambda connection-pooling problem disappears.** [0002](0002-serverless-lambda-over-containers.md) flagged RDS connection handling from Lambda as an open question; DynamoDB is an HTTP API with no connection pool, so that question no longer exists.

**Clean Architecture absorbed the change well.** The domain layer — the scheduling algorithm, the sprint calculation, the weighted average, the status rules — did not change at all, because none of it ever knew what the database was. Only the `infrastructure/` layer was rewritten. This is the clearest evidence in the project that the layering was worth the effort.
