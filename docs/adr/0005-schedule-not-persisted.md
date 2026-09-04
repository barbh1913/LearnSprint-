# 0005 — The generated schedule is not a stored entity

## Context

FR3.1–FR3.3 produce a schedule (time blocks for each learning action, plus the mastery-weighted review session). This reasoning already existed as a note in `docs/erd.md`; it's promoted to an ADR here because it's a real architectural decision — it shapes the Application layer's API (a `GenerateSchedule` use case, not a `Schedule` repository) — not just a data-modeling footnote.

## Decision

The schedule is never written to the database. It's computed on demand in the Domain layer from `UserConstraints`, `UserTopicProgress.masteryLevel`, and the shared topic/action list, and returned directly to the caller.

## Alternatives considered

- **Persist the schedule, invalidate/recompute on relevant changes**: would let the system answer "what was I told to do last Tuesday" and avoid recomputing on every page load, but requires an invalidation strategy every time a shared `Topic`/`Action` changes under a Study Group member, or a `UserTopicProgress.masteryLevel` changes — extra complexity with no FR currently asking for schedule history.

## Consequences

- Viable specifically because NFR2 requires the computation to finish in under 2 seconds — "always recompute" only works because recomputing is cheap.
- No cache-invalidation logic is needed anywhere in the system for the schedule.
- If schedule history ever becomes a real requirement, it's a new, explicitly-versioned snapshot entity added later — not a retrofit onto this decision.
