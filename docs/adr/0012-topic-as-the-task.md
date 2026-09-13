# 0012 — The Topic is the task: subtasks, priority levels, materials and one detail view

Builds on the data model in [ADR 0006](0006-dynamodb-single-table.md) and the Calendar of [ADR 0010](0010-google-calendar-sync-via-direct-api.md) / [ADR 0011](0011-one-plan-per-student-nearest-exam-first.md).

## Context

Bar wanted the board and the Calendar to feel like a Jira or Linear board: click a card, get one detail panel, edit everything there — title, description, status, priority, estimated time, subtasks, attachments — and see the same item on the Calendar. The obvious way to get there is a new "Task" entity with the Topic hanging off it. That would have been a second unit of work next to the one every other feature already keys on.

## Decision

**The existing `Topic` is the task. Nothing new sits above it.**

- **Subtasks are the existing learning actions.** FR2.3's three defaults (read / summarize / quiz) are still created with every topic, but an action now has a `title`, an `order` and may be of type `custom`, and the student can add, rename and delete them. Everything that already reasoned about "the topic's actions" — status derivation (all done → rate mastery), the board's progress bar, the scheduler, the `.ics` — keeps working unchanged, because none of it ever assumed exactly three. A topic keeps at least one subtask so it never becomes un-schedulable by accident. Subtasks are shared course content, so a change reaches the whole study group exactly like a renamed topic does (FR5.2).
- **Priority becomes a level, and the scheduler doesn't change.** `isPriority: boolean` becomes `priority: low | medium | high`. Old items are read as `high` when they were flagged and `medium` otherwise, and the scheduler's existing boost (FR3.2) applies to `high` — so every existing plan is exactly what it was. Whether `low` should be de-weighted is a separate, explicit decision; this ADR deliberately does not make it.
- **Estimated time is still the sum of the subtasks.** A topic-level edit is a convenience: the new total is split across the subtasks in proportion to their current estimates (largest-remainder rounding, so it adds up exactly), each staying editable on its own. No second "topic estimate" is stored that could disagree with the parts.
- **Materials are the first real file record.** Upload for topic extraction stays write-once. A file attached to a topic gets a `Material` row (owner, course, topic, S3 key) under the course partition, next to the topic's actions, and is served through short-lived presigned S3 URLs — the bucket stays private. Materials are private to their uploader in this release; the row already carries `userId`, so sharing within a group later is a rule in the application layer, not a schema change.
- **Assignee is the student, by construction.** Progress is private per user (`UserTopicProgress`), so "who is working on this topic" is always "me". The panel shows that as a fact, not a field.
- **The Calendar shows topics, not actions.** A topic's consecutive scheduled actions are merged into one event covering their combined time; the review session and study-aid preparation stay separate events. The merge is a pure step over the scheduler's output — the allocation algorithm is untouched — and the same topic events feed the screen, the `.ics` export and the Google sync, so all three show the same thing. Clicking an event opens the board's detail dialog with those subtasks highlighted: two views, one topic.

## Alternatives considered

- **A new `Task`/`Lecture` entity above `Topic`.** Would have meant a second identity for every piece of progress, a migration of every existing topic, and two places to keep in sync. The topic already *is* the unit of planning; it only lacked fields.
- **A separate `Subtask` entity next to actions.** Two lists under one topic, with status derivation having to decide which one counts. The actions already have per-user done-state, durations and a place in the scheduler — making them editable is the whole feature.
- **Storing a topic-level estimate.** Simpler to edit, but it would drift from the subtask minutes the scheduler actually uses. Deriving it keeps one truth.
- **Rendering actions on the Calendar and grouping in the browser only.** Cheapest, but the `.ics` and Google would still show per-action items — the same plan looking different in three places.

## Consequences

- `ActionType` gains `custom`; block labels come from the action's title, so default topics still read "Read: Trees" everywhere.
- Deleting a subtask cascades to every member's `UserActionProgress`, the way deleting a topic already did; deleting a topic now also removes its materials (rows and objects).
- Six new routes on `learnsprint-content-topics` (subtask create/delete, material upload/list/download/delete) and no new function or table.
- The schedule endpoints gain an `events` list next to `blocks`; the board and the Calendar keep consuming the same `BoardCard` for the detail dialog.
