# Deployment — CDK stacks

What AWS CDK (Python) provisions, at the stack level. Built in the AWS phase of the roadmap — nothing here exists yet locally (see [ADR 0003](../adr/0003-local-first-then-incremental-aws.md)).

```mermaid
flowchart TB
    subgraph FrontendStack["FrontendStack"]
        S3F["S3 bucket — static site"]
        CFD["CloudFront distribution"]
        S3F --> CFD
    end

    subgraph DataStack["DataStack"]
        RDS["RDS PostgreSQL instance"]
        S3U["S3 bucket — uploads"]
    end

    subgraph AuthStack["AuthStack"]
        Cognito["Cognito User Pool + App Client"]
    end

    subgraph ApiStack["ApiStack (per feature)"]
        GW["API Gateway"]
        Lambdas["Lambda functions — one per feature"]
        GW --> Lambdas
    end

    ApiStack -->|reads connection info from| DataStack
    ApiStack -->|validates tokens via| AuthStack
    FrontendStack -->|calls| ApiStack
```

Each stack deploys independently via GitHub Actions (AWS OIDC, no long-lived AWS keys in CI). The frontend pipeline builds the Vite bundle, syncs it to `S3F`, and invalidates `CFD`. The backend pipeline packages each feature's Lambda and deploys via `cdk deploy` for `ApiStack`.

Stacks are introduced in the order they're needed, per the roadmap in CLAUDE.md — `FrontendStack` and a minimal `ApiStack`/`DataStack` first, `AuthStack` (Cognito) once local JWT auth is ready to be swapped out.
