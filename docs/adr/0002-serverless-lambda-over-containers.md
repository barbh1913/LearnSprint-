# 0002 — Serverless (API Gateway + Lambda) over containers

## Context

The backend needs to run on AWS. Traffic for this system is a single student plus, later, a small study group — sparse and bursty, not sustained production load. An earlier draft of the architecture used ECS Fargate behind an Application Load Balancer, with RDS in a private VPC.

## Decision

The backend deploys as multiple AWS Lambda functions grouped by business feature, behind API Gateway, backed by RDS PostgreSQL. Infrastructure is provisioned with AWS CDK (Python).

Lambdas are grouped by feature (`academic_profile`, `content_topics`, `scheduling`, `progress`, `study_groups`) — not one monolithic Lambda for the whole API, and not one Lambda per endpoint. This mirrors the backend's feature-based code organization (see [0004](0004-feature-based-backend-organization.md)), keeps each function's cold-start footprint small, and avoids the operational overhead of managing dozens of single-endpoint functions.

## Alternatives considered

- **ECS Fargate + ALB**: always-on compute, no cold starts, but an ALB and a running Fargate task both bill continuously — real ongoing cost for a workload that's idle most of the time. Also more infrastructure to configure (task definitions, ECR, VPC networking) for no functional benefit at this scale.
- **One Lambda for the whole API** (a single FastAPI app wrapped for Lambda): simplest to deploy, but couples every feature's deployment and blast radius together, and works against the feature-based backend organization.
- **One Lambda per endpoint**: maximal isolation, but a lot of near-duplicate deployment configuration and more cold starts (each narrow function is invoked less often, so stays cold more often), for a project of this size.

## Consequences

- Lambda cold starts and the 15-minute max execution time are both acceptable for this system's request patterns (simple CRUD, plus a schedule computation that must run in under 2 seconds per NFR2 anyway).
- RDS Postgres is reached from Lambda functions; connection handling (pooling/reuse across invocations) is a detail to work out when the AWS phase starts, not now.
- API Gateway owns routing between feature groups, so each Lambda only needs to know about its own feature's routes.
