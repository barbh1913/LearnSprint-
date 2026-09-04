# Request flow

## Planning a sprint — the core loop

What happens when the student drags a topic into this week's sprint. This is the interaction the whole product exists for.

```mermaid
sequenceDiagram
    actor S as Student
    participant UI as Board (React)
    participant API as FastAPI
    participant DDB as DynamoDB
    participant Dom as sprint (Domain)

    S->>UI: drag topic into "To do"
    UI->>UI: move card immediately (optimistic)
    UI->>API: PATCH /topics/{id}/progress {status: todo}
    API->>DDB: put UserTopicProgress
    UI->>API: GET /sprint
    API->>DDB: query memberships, topics, progress
    API->>API: sum remaining action time for To do + In progress
    API->>Dom: build_sprint_plan(now, constraints, committed)
    Dom->>Dom: compute this week's free windows
    Dom->>Dom: classify healthy / tight / over_committed
    Dom-->>API: SprintPlan
    API-->>UI: capacity, commitment, status
    UI-->>S: "This week fits" - or a warning, before the week starts
```

The card moves before the server responds, so the drag feels immediate; the reload that follows replaces the optimistic state with the derived truth.

## Generating a study plan

```mermaid
sequenceDiagram
    actor S as Student
    participant API as FastAPI
    participant DDB as DynamoDB
    participant Alg as allocation (Domain)

    S->>API: GET /courses/{id}/schedule
    API->>DDB: fetch course and constraints
    API->>DDB: fetch topics + actions (one query)
    API->>DDB: fetch my progress
    API->>API: keep only unfinished actions
    API->>Alg: generate_schedule(now, exam date, topics, constraints)
    Alg->>Alg: free windows, minus blocked hours
    Alg->>Alg: normal / emergency / infeasible
    Alg-->>API: Schedule or InfeasiblePlan
    API-->>S: time blocks, or how much time to free up
```

The schedule is computed per request and never stored ([ADR 0005](../adr/0005-schedule-not-persisted.md)), so it cannot go stale when a mastery rating changes.

## Analysing uploaded material

```mermaid
sequenceDiagram
    actor S as Student
    participant API as FastAPI
    participant P as file_parser
    participant AI as ai_extractor
    participant H as extraction (Domain)
    participant DDB as DynamoDB

    S->>API: POST /topics/extract (up to 15 files)
    API->>P: read text from every file
    P-->>API: one combined corpus
    API->>DDB: read my AI settings

    alt AI enabled and key present
        API->>AI: analyse with the student's own key
        AI-->>API: topics + per-topic minutes
    else disabled, or the AI call failed
        API->>H: keyword heuristic
        H-->>API: topics (default durations)
    end

    API->>DDB: create topics, each with read/summarise/quiz
    API-->>S: topics found, which analyser ran, total study time
```

The fallback arm is the important one: an AI failure downgrades the quality of the estimate, never the success of the upload.
