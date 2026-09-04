# Request flow — generate schedule

Representative request/response path for "generate my schedule" (FR3.1–FR3.3), once deployed to AWS. Locally, the same path exists minus CloudFront/API Gateway/Cognito — the browser calls FastAPI directly.

```mermaid
sequenceDiagram
    actor U as Student (browser)
    participant CF as CloudFront
    participant GW as API Gateway
    participant Auth as Cognito
    participant L as Lambda: scheduling
    participant DB as RDS PostgreSQL

    U->>CF: GET / (SPA shell, once)
    U->>GW: GET /schedule (Bearer JWT)
    GW->>Auth: validate token
    Auth-->>GW: valid, userId
    GW->>L: invoke(event, userId)
    L->>DB: fetch UserConstraints(userId)
    L->>DB: fetch Topics + Actions (course)
    L->>DB: fetch UserTopicProgress(userId)
    L->>L: run allocation algorithm (Domain layer, in-memory)
    L-->>GW: schedule JSON
    GW-->>U: 200 OK, schedule JSON
```

The schedule itself is never written back to `DB` — see [ADR 0005](../adr/0005-schedule-not-persisted.md).
