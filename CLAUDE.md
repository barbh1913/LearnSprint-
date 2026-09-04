# LearnSprint — Agent Working Agreement (CLAUDE.md)

This document is the contract between Bar (the student) and the agent. Every code change must align with this document. If something is unclear or contradictory, stop and ask — don't guess.

See also [ABOUT.md](ABOUT.md) for the personal context and goal behind this project.

## What the system is

LearnSprint is an academic learning planner built around Agile/Scrum planning concepts: the student enters courses and time constraints, uploads study material (PDF/PPTX), the system extracts a list of topics from it into a **Sprint Backlog**, auto-generates three learning actions per topic (read/summarize/quiz), and builds a personal schedule that accounts for the student's mastery level per topic and the time left before the exam. Progress is tracked on a Kanban-style Sprint board (section 4).

The system also supports **Study Groups**: students in the same course can share a backlog of topics and learning actions, while each member still gets a personal schedule based on their own constraints and progress (see section 5 below).

Note on terminology: the Agile/Sprint framing is applied to naming and UI copy only — the underlying entities (`Topic`, `Action`, etc., see the Data Dictionary) keep their existing names rather than being renamed to Agile jargon (e.g. "Story"), so the data model stays stable as this framing evolves.

## Tech stack (fixed — don't deviate without asking)

The system is a physically separated frontend and backend, deployed serverless on AWS. See [docs/adr/](docs/adr/) for the reasoning behind these choices and [docs/diagrams/](docs/diagrams/) for the visual architecture.

- **Frontend**: React + TypeScript + Vite, styled with Tailwind CSS + shadcn/ui (Radix-based) components, Lucide-react icons, React Router DOM for client-side routing. Explicit types for every entity (see data dictionary below), no `any`.
- **Backend**: Python + FastAPI. Pydantic for request/response schemas, SQLAlchemy for the ORM, Alembic for migrations. Type-hinted throughout — no untyped functions.
- **Clean Architecture**, organized by business feature (see `backend/src/features/`), with each feature keeping its own:
  - **Domain** — entities and pure business logic (schedule calculation, weighted average, time-allocation algorithm) — no dependency on UI, DB, or web framework.
  - **Application/Use Cases** — orchestration of the logic (e.g. "generate schedule for course").
  - **Infrastructure** — DB access, text extraction from files, AWS adapters (auth, storage).
  - **Presentation** — FastAPI routers locally, Lambda handlers in production; both thin, no business logic.
- **Local development has no AWS dependency**: FastAPI + Vite dev servers against a local Postgres container.
- **Target deployment (added incrementally, after the core FRs work locally)**: React build on S3 + CloudFront; API Gateway routing to Lambda functions grouped by business feature; RDS PostgreSQL; Cognito for auth; CloudWatch for logs/metrics; all provisioned via AWS CDK (Python).
- **Testing**: `pytest` for the backend (heaviest on the Domain layer, especially the FR3.2 algorithm), Vitest + React Testing Library for the frontend.
- Clean, readable code: meaningful names, small focused functions, no comments that explain "what" (the code itself should be clear) — comments only when there's a non-obvious reason.

## Functional Requirements

### 1. Academic management & profile
- **FR1.1** — Define time constraints: fixed blocked hours (work/other commitments) + preferred study time (morning/evening).
- **FR1.2** — Set up a course: year (1st/2nd/3rd...), semester, course name, credit points.
- **FR1.3** — Enter a final grade per course + compute a weighted average (per semester and overall, by credit points).
- **FR1.4** — Two views: a focused single-course view, and a global view aggregating all courses in a semester.

### 2. Content analysis & topic management
- **FR2.1** — Extract a list of topics from an uploaded PDF/PPTX file, supporting Hebrew and English.
- **FR2.2** — Full editing of the extracted topic list: add, delete, rename.
- **FR2.3** — Each topic automatically gets 3 learning actions: read, summarize, quiz.
- **FR2.4** — Let the user rate their "mastery level" per topic, on a 1–5 scale.
- **FR2.5** — Per-topic status: `Backlog` / `To Do` / `In Progress` / `Needs Review` / `Done` (see FR4.2 for how a topic moves between these).
- **FR2.6** — Let the user manually mark a topic as a priority/core exam topic. This is a manual toggle, not extracted or inferred by the system — the extraction step (FR2.1) only pulls topic names, nothing about importance.

### 3. Scheduling & learning strategy
- **FR3.1** — Build a schedule based on the user's constraints and the exam date, allocating time to each learning action.
- **FR3.2** — A "general review session" before the exam, with **dynamic time allocation**: the lower the mastery level of a topic, the larger the time share it gets in the review session. This is the project's core algorithm (the "Algorithms" grading section) — document it thoroughly and cover it with unit tests.
- **FR3.3** — Define exam type (open material / formula sheet). If applicable, allocate dedicated time for preparing those aids.

### 4. Sprint board
- **FR4.1** — The system displays an interactive Kanban board (per course, and globally across courses per FR1.4), with columns `Backlog`, `To Do`, `In Progress`, `Needs Review`, `Done`, showing every topic's current status and, for the in-progress one(s), which learning action is active.
- **FR4.2** — Status is derived automatically by default: a topic starts at `Backlog` on extraction (FR2.1), moves to `To Do` once pulled into the active study plan, to `In Progress` once its first learning action is started, and once all three actions (FR2.3) are marked done, the system prompts for a mastery rating (FR2.4) and sets the topic to `Needs Review` (mastery ≤ 2) or `Done` (mastery ≥ 3).
- **FR4.3** — The student can also manually drag a card between columns to override the automatic status — e.g. pulling a topic from `Backlog` into `To Do` to plan it in, or dragging a `Done` topic back to `Needs Review` to redo it. A manual drag persists until the next automatic trigger (an action completed, a mastery rating given) fires and recomputes status normally.
- **FR4.4** — The board visually highlights `To Do` topics ("waiting to start") so the student can see at a glance what to pick up next.

Manual drags are an override, not the primary mechanism — the system still derives status automatically whenever there's real signal (an action finished, a mastery rating given). Dragging exists for planning/re-prioritizing, not for marking work done without doing it.

### 5. Sharing & Study Groups
- **FR5.1** — Create a study group and associate multiple users with a shared course (invite by email).
- **FR5.2** — Changes to the course structure (topics and learning actions) sync across all group members — one shared backlog, not a per-user copy.
- **FR5.3** — Show an aggregate progress indicator (progress bar) for each group member, for peer monitoring, without exposing that member's personal schedule.
- **FR5.4** — Privacy: personal grades and time constraints are **never** exposed to group members — only general progress status.

> Scope decision: this is an extension on top of the single-user core (FR1–FR3). Implement the core first until it's stable, then build the sharing layer — don't build sync on top of an immature data model.

### 6. Visual timeline (Gantt)
- **FR6.1** — A weekly Gantt-style view renders the schedule already produced by FR3.1–FR3.3 as time blocks across the days of the week, grouped by topic. This is a visualization of existing schedule output — no new scheduling logic.

### 7. Study velocity
- **FR7.1** — The dashboard shows a "study velocity" indicator: completed learning actions per week (`UserActionProgress.completedAt`) and the recent trend in average mastery (`UserTopicProgress.masteryLevel`), computed from existing progress data.

### 8. Friends
- **FR8.1** — A user can send another user a friend request by email and accept/decline incoming requests, independent of any shared course or Study Group (FR5).
- **FR8.2** — The Profile view lists a user's friends, each showing the same coarse-grained aggregate progress indicator defined in FR5.3 — never grades or constraints, per NFR3.

## Use Cases — Study Groups

- **UC10 — Create a study group**: Actors: student (owner), system. The student sets up/selects a course and invites members by email; the system sends join notifications.
- **UC11 — Collaborative backlog editing**: Actors: group members. Any member can edit topics/actions/time estimates; the change is reflected for everyone.
- **UC12 — Group progress monitoring**: Actors: group members. The course dashboard shows a progress bar per group member, without exposing personal schedules or grades.

(Core single-user use cases — course setup, topic extraction, schedule generation — will be numbered UC1–UC9 in the full spec document when written; the numbering here continues intentionally from there.)

## Data Dictionary

Full ER diagram: [docs/erd.md](docs/erd.md). Sharing changes the data model: some data is **shared** within a group (course content, topics, actions), and some is strictly **private per user** (constraints, grades, personal progress) — including for a solo, non-grouped course. Model this explicitly with separate tables — don't bolt privacy on as a filter over shared rows.

| Entity | Fields | Shared / Private |
|---|---|---|
| **User** | `id`, `email`, `passwordHash`, `createdAt` | Private (account record; owns everything else via `userId` FKs) |
| **Course** | `id`, `name`, `year`, `semester`, `credits`, `topics: Topic[]` | Shared (course content only — no grade, no owner field) |
| **CourseMembership** | `userId`, `courseId`, `role: 'owner' \| 'member'`, `finalGrade?` | Private (one row per user per course; also what makes them a course/group member) |
| **Topic** | `id`, `courseId`, `name`, `isPriority: boolean`, `actions: Action[]` | Shared |
| **Action** | `id`, `topicId`, `type: 'read' \| 'summarize' \| 'quiz'`, `defaultDurationMinutes` | Shared (default estimate, not the actual scheduled time) |
| **UserTopicProgress** | `userId`, `topicId`, `status: 'backlog' \| 'todo' \| 'in_progress' \| 'needs_review' \| 'done'`, `masteryLevel?: 1..5` | Private (per-user view of a shared Topic) |
| **UserActionProgress** | `userId`, `actionId`, `isDone: boolean`, `completedAt?: DateTime` | Private |
| **UserConstraints** | `userId`, `blockedSlots: {day, startTime, endTime}[]`, `timePreference: 'morning' \| 'evening'` | Private |
| **Friendship** | `id`, `userId`, `friendId`, `status: 'pending' \| 'accepted'` | Private (visible only to the two users involved) |

Define these as explicit types in the backend Domain layer (Python dataclasses or Pydantic models, per feature) and mirror them as TypeScript types on the frontend — reuse consistently within each side, no duplicate near-identical types.

Notes on the model:
- There is no standalone `StudyGroup` entity. A group is just the set of `CourseMembership` rows for a course — one course, one implicit group. Ownership is `CourseMembership.role === 'owner'`, not a separate field on `Course`.
- `masteryLevel` and topic `status` live on `UserTopicProgress`, not on `Topic` — the FR3.2 algorithm reads mastery per `(user, topic)`, never a shared value.
- `finalGrade` lives on `CourseMembership`, never on `Course` — this is what makes FR5.4 (grade privacy) structurally true rather than a UI-level filter.
- **The generated schedule (FR3.1–FR3.3 output) is not a stored entity.** It's computed on demand in the Domain layer from `UserConstraints` + `UserTopicProgress.masteryLevel` + the shared topic/action list, which is viable specifically because NFR2 already requires that computation to finish in under 2 seconds. This also avoids having to invalidate a stored schedule whenever a shared topic changes under a group member. If schedule history ever becomes a requirement, that's a new, explicitly-versioned entity — not something to retrofit into this table.

## Edge cases — must be handled explicitly

1. **"Exam is tomorrow"** — if there isn't enough time for all learning actions: switch to "emergency mode" — cancel the individual actions (read/summarize/quiz separately), and generate a single review session with **equal** time allocation across all topics.
2. **Multiple languages** — auto-detect the text language (Hebrew/English) during extraction, and keep topic names in the source language without translation.
3. **Infeasibility** — if there aren't enough free hours before the exam (due to blocked hours): warn the user about "plan infeasibility" and suggest opening up blocked hours. Never silently generate a schedule that overlaps itself.
4. **Concurrent group edits** — if two group members edit the same topic/action at the same time (UC11), define and document a conflict-resolution strategy (e.g. last-write-wins with a version/updatedAt check, or optimistic locking) rather than silently discarding one edit. This is worth documenting explicitly in the write-up as a "Concurrency Control" design decision — it's a stronger signal of system maturity than the CRUD forms.

## Non-Functional Requirements

- **NFR1** — Typed code (TypeScript frontend, type-hinted Python backend) + Clean Architecture (see above).
- **NFR2** — Recomputing the schedule after a mastery-level change must run in **under 2 seconds**. If the allocation algorithm gets heavy, profile it — don't just throw async at it and hope.
- **NFR3** — Group data privacy (FR5.4) is enforced at the Domain/Application layer, not only hidden in the UI — an API response must not leak another member's grade or constraints even if the UI doesn't render them.

## Grading criteria — stay focused

| Section | Points | What it means in practice |
|---|---|---|
| Specification | 20 | This document + Use Cases + system diagrams — keep it updated as requirements change |
| UI/UX | 10 | Clean, uncluttered UX; both views (FR1.4) and the group progress view (FR5.3) need to be intuitive |
| Development | 50 | Quality frontend, full functionality per the FRs, clean code, correct API/DB usage — **this is the center of mass** |
| Algorithms | 10 | The dynamic time-allocation algorithm (FR3.2) is the "significant algorithm" — build it carefully, with tests |
| Innovation | 10 | Emergency mode (edge case 1), mastery-based allocation, and Study Groups with peer monitoring are the differentiators from a generic scheduling tool |

## How the agent should work with Bar

- Bar is an undergraduate Information Systems student building a final project. She **wants to understand and know every part of the system** — not just "have it work". See [ABOUT.md](ABOUT.md).
- Briefly explain **why** an approach was chosen, especially for architecture decisions or the dynamic allocation algorithm — don't just write code silently.
- Don't expand scope beyond the FRs without asking (no additions "because we can" — a final project is also graded on focus).
- Any requirement change (add/remove/modify an FR) — update this document first, then the code.
- Prefer small, clear changes over large leaps, so Bar can follow every step.
- All communication and documentation in this repo is in **English only** — no Hebrew in code, comments, commit messages, or docs, even though the source SRS conversation was in Hebrew.
