# Architecture

## What runs today

The application runs locally against real AWS DynamoDB. There is no local database — see [ADR 0006](../adr/0006-dynamodb-single-table.md).

```mermaid
flowchart LR
    Browser["React SPA<br/>Vite dev server :5173"]
    API["FastAPI<br/>uvicorn :8000"]
    DDB[("DynamoDB<br/>LearnSprint table")]
    Claude["Anthropic API<br/>optional, user's own key"]

    Browser -->|"/api/* proxied"| API
    API -->|boto3| DDB
    API -.->|"only when AI analysis is enabled"| Claude
```

## Inside the backend

Every feature module is layered the same way, and the dependency arrows only ever point inward — `domain` knows nothing about DynamoDB, HTTP, or Claude. That is what made the Postgres to DynamoDB migration touch only one layer.

```mermaid
flowchart TB
    subgraph Presentation["Presentation - FastAPI routers"]
        R1["courses, grades, constraints"]
        R2["topics, extract"]
        R3["schedule"]
        R4["board, sprint, velocity"]
    end

    subgraph Application["Application - use cases"]
        A1["generate_schedule"]
        A2["board_service"]
    end

    subgraph Domain["Domain - pure logic, no I/O"]
        D1["allocation<br/>mastery-weighted split"]
        D2["sprint<br/>capacity vs commitment"]
        D3["grades<br/>weighted average"]
        D4["extraction<br/>topic heuristic"]
        D5["status<br/>board rules, velocity"]
    end

    subgraph Infrastructure["Infrastructure - the outside world"]
        I1["dynamo<br/>single-table access"]
        I2["file_parser<br/>PDF and PPTX"]
        I3["ai_extractor<br/>Claude"]
    end

    R1 --> D3
    R2 --> D4
    R2 --> I2
    R2 -.->|when enabled| I3
    R3 --> A1
    R4 --> A2
    R4 --> D2
    A1 --> D1
    A2 --> D5
    A1 --> I1
    A2 --> I1
    R1 --> I1
```

Both graded algorithms — the mastery-weighted allocation and the sprint capacity calculation — live in `Domain`, take their inputs as plain values (including `now`), and return plain values. That is why they are directly unit-testable without a database, a clock, or a network.

## Target deployment

Not built. The roadmap position is deliberate: [ADR 0003](../adr/0003-local-first-then-incremental-aws.md) chose to build the features before the infrastructure. It reuses the serverless pattern already present in the AWS account.

```mermaid
flowchart LR
    Browser["React build"]
    CF["CloudFront"]
    S3["S3 - static site"]
    GW["API Gateway"]
    L["Lambda<br/>one per feature module"]
    DDB[("DynamoDB")]
    S3U["S3 - uploaded material"]

    Browser --> CF --> S3
    Browser -->|"HTTPS + JWT"| GW --> L
    L --> DDB
    L --> S3U
```

Each Lambda maps 1:1 to a backend feature module ([ADR 0004](../adr/0004-feature-based-backend-organization.md)), reusing the same application and domain code — only the entry point differs, since a Lambda handler is just another Presentation-layer adapter. DynamoDB also removes the connection-pooling problem that RDS-from-Lambda would have had ([ADR 0002](../adr/0002-serverless-lambda-over-containers.md)).
