# 0003 — Local-first development, AWS added incrementally

## Context

The target architecture is fully serverless on AWS (API Gateway, Lambda, RDS, Cognito, CloudFront/S3, CDK). None of CLAUDE.md's grading criteria score infrastructure or deployment directly — the weight is on Specification, UI/UX, Development, Algorithms, and Innovation. Standing up the full AWS stack before any FR exists would mean paying for and operating cloud infrastructure with nothing running on it yet, and CLAUDE.md's own scope note says to build the core stable before extending it.

## Decision

FR1–FR4 (and initially FR5) are built and verified entirely locally: FastAPI + Vite dev servers, a Postgres container via `docker-compose`, and a local JWT-based `AuthProvider` implementation sitting behind the same port the Cognito adapter will later implement. AWS resources are introduced only in a dedicated later phase, added one slice at a time (frontend hosting, then one Lambda feature group, then the rest), each tied to a concrete need rather than provisioned speculatively.

## Alternatives considered

- **Build against real AWS from day one**: most representative of the final deployment target, but means every FR iteration incurs AWS latency, deployment steps, and cost, and blocks fast local iteration during the stage of the project (FR1–FR4) where the logic itself is still being figured out.

## Consequences

- The `AuthProvider` port (see [0001](0001-python-fastapi-backend.md) and the Application layer) must be designed before the local JWT implementation is written, so swapping in Cognito later doesn't require touching Domain/Application/Presentation code.
- RDS is the local Postgres container's target engine from the start (not SQLite), specifically so there's no SQL-dialect surprise when the AWS phase begins.
- No AWS spend occurs during FR1–FR4 development.
