# Architecture — target AWS deployment

Component-level view of the system once the AWS phase (see [roadmap in CLAUDE.md](../../CLAUDE.md)) is built. Not the current state — see [ADR 0003](../adr/0003-local-first-then-incremental-aws.md) for what runs locally today.

```mermaid
flowchart LR
    subgraph Client
        Browser["React SPA (Vite build)"]
    end

    subgraph Edge
        CF["CloudFront"]
        S3F["S3 — static frontend"]
    end

    subgraph API
        APIGW["API Gateway"]
        L1["Lambda: academic_profile"]
        L2["Lambda: content_topics"]
        L3["Lambda: scheduling"]
        L4["Lambda: progress"]
        L5["Lambda: study_groups"]
    end

    subgraph Data
        RDS["RDS PostgreSQL"]
    end

    subgraph Auth
        Cognito["Cognito User Pool"]
    end

    subgraph Storage
        S3U["S3 — uploaded PDFs/PPTX"]
    end

    Obs["CloudWatch — logs & metrics"]

    Browser -->|static assets| CF --> S3F
    Browser -->|HTTPS API calls, Cognito JWT| APIGW
    APIGW --> L1 & L2 & L3 & L4 & L5
    L1 & L2 & L3 & L4 & L5 --> RDS
    L2 -->|read uploaded file| S3U
    Browser -.->|login/token| Cognito
    APIGW -.->|validate JWT| Cognito
    L1 & L2 & L3 & L4 & L5 -.->|structured logs| Obs
```

Each Lambda group corresponds 1:1 to a backend feature module (`backend/src/features/*`, see [ADR 0004](../adr/0004-feature-based-backend-organization.md)) — same Application-layer use cases, deployed as a separate function per feature rather than one monolith or one function per endpoint ([ADR 0002](../adr/0002-serverless-lambda-over-containers.md)).
