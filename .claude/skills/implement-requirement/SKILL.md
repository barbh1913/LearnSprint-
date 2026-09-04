---
name: implement-requirement
description: Use when implementing or extending a functional requirement (FR) from the LearnSprint spec (CLAUDE.md) end-to-end. Walks through the Clean Architecture layers in order and keeps the spec and code in sync. Trigger on requests like "implement FR2.3", "add the mastery rating feature", "build the group progress view".
---

# Implement a functional requirement

Use this workflow whenever the task is to build or change something tied to a specific FR in the repo's `CLAUDE.md`.

## Steps

1. **Locate the FR.** Find its exact wording in `CLAUDE.md`. If the request doesn't map cleanly to an existing FR, stop and ask whether to add a new FR to the spec first, or whether this is in scope at all.
2. **Check the data dictionary.** Confirm which entities/fields the FR touches. If it needs a new field or entity, add it to the Data Dictionary table in `CLAUDE.md` before writing code — types should never be invented ad hoc in a component.
3. **Domain first.** Implement or update the pure logic (types, entities, calculations) in the Domain layer with no UI or DB dependency. If the FR involves the scheduling/allocation algorithm, see the `schedule-algorithm` skill.
4. **Application layer.** Add or update the use case that orchestrates the domain logic (e.g. "recompute schedule after mastery change").
5. **Infrastructure.** Wire up persistence or file/API access only as needed to satisfy the use case — don't let DB or parsing concerns leak into Domain.
6. **Presentation.** Build the UI last, consuming the use case. No business logic in components.
7. **Tests.** Any Domain-layer logic with a nontrivial calculation (averages, time allocation, feasibility checks) gets unit tests. UI flows get a manual pass through the browser preview.
8. **Re-check edge cases.** Re-read the "Edge cases" section in `CLAUDE.md` — does this FR interact with the emergency-mode, infeasibility warning, multi-language, or concurrent-edit cases? If so, handle it explicitly rather than leaving it implicit.
9. **Explain the result to Bar** in a couple of sentences: what was built, which layer each piece lives in, and why any non-obvious choice was made.
