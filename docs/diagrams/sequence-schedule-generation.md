# Sequence — FR3.2 mastery-weighted allocation

Internal flow of the Domain-layer algorithm itself (the graded "significant algorithm"), independent of transport (Lambda/FastAPI) — see the `schedule-algorithm` skill for the design rules this must follow.

```mermaid
sequenceDiagram
    participant UC as GenerateScheduleUseCase (Application)
    participant Alg as Allocation algorithm (Domain)

    UC->>Alg: allocate(constraints, topics, masteryByTopic, examDate)
    Alg->>Alg: compute available_time = free hours before examDate minus blocked slots
    Alg->>Alg: compute needed_time = sum of all pending action durations

    alt available_time < needed_time (emergency mode)
        Alg->>Alg: drop per-action granularity
        Alg->>Alg: split available_time equally across topics
    else enough time for individual actions
        alt available_time also >= needed_time + review session minimum
            Alg->>Alg: schedule each pending action in its slot
            Alg->>Alg: weight(topic) = (6 - masteryLevel), normalized across topics
            Alg->>Alg: split review-session time by weight (uniform weights if mastery is unrated or equal)
        else not enough time even for emergency mode
            Alg-->>UC: Infeasible(reason, suggested free-up hours)
        end
    end

    Alg-->>UC: Schedule(blocks: TimeBlock[])
```

See [ADR 0005](../adr/0005-schedule-not-persisted.md) for why `Schedule` is returned directly and never persisted.
