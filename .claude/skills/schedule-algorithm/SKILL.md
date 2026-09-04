---
name: schedule-algorithm
description: Use when building, changing, or reviewing the scheduling / time-allocation logic in the LearnSprint project (FR3.1–FR3.3) — especially the mastery-weighted review-session split. This is the project's graded "significant algorithm", so treat it with more rigor than ordinary CRUD code. Trigger on requests like "build the review session split", "the schedule seems wrong", "recompute the allocation".
---

# Scheduling / time-allocation algorithm

This algorithm is graded explicitly under "Algorithms" in the rubric (see `CLAUDE.md`). Treat correctness and edge-case handling as first-class, not an afterthought.

## Design checklist before writing code

- Inputs: exam date, `UserConstraints` (blocked slots, time preference), the topic list with each topic's `Action[]` and the user's `masteryLevel` (from `UserTopicProgress`), and the exam type (open material / formula sheet, per FR3.3).
- Output: a concrete schedule — time blocks assigned to specific actions (read/summarize/quiz) plus the review session, none of them overlapping a blocked slot.
- The review-session split (FR3.2) is **inversely weighted by mastery**: lower mastery → larger time share. Write the weighting formula down explicitly (e.g. `weight(topic) = (6 - masteryLevel)`, normalized across topics) before implementing — don't let it become an implicit side effect of loop order.

## Edge cases this algorithm must cover (see CLAUDE.md → Edge cases)

1. **Emergency mode** ("exam is tomorrow"): if available time < time needed for all individual actions, drop per-action granularity and produce a single review session split **equally** across topics. Implement this as an explicit branch/strategy, not a bolt-on special case scattered through the main path.
2. **Infeasibility**: if available time is insufficient even for the emergency-mode session, don't silently overlap or truncate — return/raise a explicit "infeasible" result the Application layer can surface as a warning to the user, suggesting they free up blocked hours.
3. **Zero or uniform mastery data**: if every topic has the same mastery level (or none rated yet), the weighted split must degrade gracefully to an equal split — verify this isn't a divide-by-zero or NaN case in the normalization step.
4. **Recompute on mastery change**: changing one topic's `masteryLevel` must trigger a full, correct recompute of the review session (not just that topic's slice) — and per NFR2, it must finish in under 2 seconds.

## Testing

Write unit tests in the Domain layer (no UI, no DB) covering: normal weighted split, emergency mode, infeasibility, uniform mastery, and single-topic edge case. These tests double as the clearest artifact to show an advisor that the "significant algorithm" requirement is genuinely met.

## When reviewing existing allocation code

Check for: hidden coupling to UI or DB in the Domain function, magic numbers instead of a named/documented weighting formula, and whether the edge cases above are handled by explicit branches you can point to — not implicit behavior you'd have to explain by tracing through the loop.
