# 0004 — Feature-based backend organization

## Context

CLAUDE.md requires Clean Architecture layering (Domain → Application → Infrastructure → Presentation). A strict top-level split by layer (`domain/`, `application/`, `infrastructure/`, `presentation/`, each containing every FR's code) would grow one large, cross-cutting folder per layer as FR1–FR5 are added, and doesn't map naturally onto the decision in [0002](0002-serverless-lambda-over-containers.md) to deploy Lambdas grouped by business feature.

## Decision

The backend is organized primarily by business feature (`academic_profile`, `content_topics`, `scheduling`, `progress`, `study_groups`), and each feature folder internally keeps the full Domain → Application → Infrastructure → Presentation split. Code that's genuinely cross-feature (shared entities referenced by more than one feature, the DB session, the auth dependency) lives in a `shared/` module.

## Alternatives considered

- **Top-level layer folders, FRs mixed within each**: the more textbook-literal reading of Clean Architecture, but doesn't scale cleanly to five FRs and doesn't map to the Lambda-per-feature-group deployment split — would need a second, parallel grouping just for deployment.

## Consequences

- Each feature module is still internally layered, so the Clean Architecture rule ("no business logic in routers/handlers", "Domain has no framework dependency") applies exactly as before — this decision changes the top-level grouping, not the layering discipline itself.
- Locally, `main.py` mounts every feature's FastAPI router into one app for a simple dev experience. In the AWS phase, each feature's router becomes its own Lambda behind API Gateway, reusing the same Application-layer use cases — only the Presentation-layer entry point differs.
- `shared/` is kept deliberately small — a feature reaching into another feature's internals (not through `shared/`) is a sign the boundary was drawn wrong, and worth revisiting rather than working around.
