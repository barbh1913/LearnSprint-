# Use cases

All use cases share one actor unless stated otherwise: **Student** — an authenticated user. The **System** is the second actor throughout.

UC1–UC9 cover the single-user core. UC10–UC12 cover Study Groups, which were built after the core on purpose so they landed on a stable data model — see the scope note in [CLAUDE.md](../CLAUDE.md). UC13 covers the optional Google Calendar sync.

---

## UC1 — Register and sign in

**Requirement:** authentication foundation
**Precondition:** none
**Main flow:**
1. Student enters an email and a password of at least 8 characters.
2. System creates the account and returns a signed token.
3. Student is taken to the dashboard.

**Alternative flows:**
- *Email already registered* — System rejects the registration (409) and the Student can switch to signing in.
- *Wrong password on sign-in* — System returns a generic "invalid email or password" (401), deliberately not revealing whether the email exists.

**Postcondition:** the Student holds a token; every later request carries it.

---

## UC2 — Define time constraints

**Requirement:** FR1.1
**Precondition:** Student is signed in.
**Main flow:**
1. Student opens Profile.
2. Student adds blocked hours — work shifts, lectures — as day + start + end.
3. Student picks a preferred study time: mornings (06:00–14:00) or evenings (15:00–23:00).
4. System saves the constraints.

**Postcondition:** every later capacity and schedule calculation plans around these hours. This is the input the whole sprint model rests on.

---

## UC3 — Set up a course

**Requirement:** FR1.2
**Main flow:**
1. Student enters the course name, year, semester, and credit points.
2. Student optionally sets the exam date and exam type (closed book / open material / formula sheet).
3. System creates the course and enrols the Student as its owner.

**Alternative flow:** *No exam date* — the course is created, but no study plan can be generated until a date is set (UC7 reports this).

---

## UC4 — Upload course material and extract topics

**Requirement:** FR2.1, FR2.3, FR2.7
**Precondition:** the course exists.
**Main flow:**
1. Student selects up to 15 PDF or PPTX files.
2. System extracts the text from all of them and treats it as one corpus.
3. System identifies the study topics — using Claude when the backend's AI analysis is available (FR2.7), otherwise a keyword heuristic.
4. System creates each topic with three learning actions: read, summarise, quiz.
5. System reports how many topics were found, in which language, and the total estimated study time.

**Alternative flows:**
- *AI unavailable or the call fails* — System falls back to the heuristic, creates the topics anyway, and tells the Student which analyser ran. An AI outage never costs the Student their upload.
- *Unsupported file type* — rejected (400) before anything is created.
- *More than 15 files* — rejected (413).
- *No topics found* — System reports it (422) and suggests adding topics by hand.

**Postcondition:** the course has a topic backlog. Topic names stay in their source language — Hebrew stays Hebrew, never translated.

---

## UC5 — Analyse one file into the right topic

**Requirement:** FR2.7, FR2.8, FR2.9
**Precondition:** the course exists (it may already have topics).
**Main flow:**
1. Student picks one PDF or PPTX on the course page and chooses "Analyse".
2. System stores the file under the Student's own prefix and extracts its text.
3. System works out what the file is about — a title, a summary, key points and an estimated study time — with Claude when the backend's AI is available, otherwise with the keyword heuristic.
4. System's matcher compares that content with the course's existing topics and shows a decision dialog: the recommended topic (or "create a new topic"), a confidence, a plain-words reason, and up to two alternatives.
5. Student chooses: attach to the recommended topic, attach to another topic, or create a new topic (editing the suggested title if they like).
6. System files the material under the chosen topic — creating the topic with its three learning actions and the estimated time when asked to — and refreshes the topic's description from the summary and key points.

**Alternative flows:**
- *No topic matches well* — the recommendation is "create a new topic" with the suggested title; the Student can still pick an existing topic.
- *AI unavailable* — the heuristic's content is used and the dialog says so; the matcher runs exactly the same way.
- *The chosen topic was deleted in the meantime* — System reports it (404) and the material stays unfiled for the Student to decide again.
- *The Student confirms twice (a retry, a double click)* — the second confirmation returns the first result; no second topic, no second attachment.
- *Unsupported or unreadable file* — rejected (400) before anything is analysed; a stored file is never lost because analysis failed.

**Postcondition:** the material is listed on its topic and the topic is part of the backlog and the plan like any other. Existing progress on that topic is untouched.

---

## UC6 — Plan the weekly sprint

**Requirement:** FR4.0, FR4.0.1 — *this is the product's core loop*
**Precondition:** the course has topics; constraints are set (UC2).
**Main flow:**
1. Student opens the board.
2. System computes **capacity** — the free study minutes left in the current week after blocked hours.
3. Student drags topics from Backlog into To do, committing to them for this week.
4. After each move, System recomputes the **commitment** (remaining action time for topics in To do / In progress) and compares it to capacity.
5. System classifies the sprint: `empty`, `healthy`, `tight`, `over_committed`, or `no_capacity`.

**Alternative flows:**
- *Commitment exceeds capacity* — System flags it and suggests moving topics back to Backlog or freeing blocked hours. **The Student learns this before the week starts, not after it fails.**
- *Every hour is blocked* — System reports `no_capacity` and points at the Profile.

**Postcondition:** the Student has a commitment they know actually fits.

---

## UC7 — Generate a study plan

**Requirement:** FR3.1, FR3.2, FR3.3
**Precondition:** the course has an exam date and unfinished topics.
**Main flow:**
1. Student opens the study plan for a course.
2. System finds the free windows between now and the exam — minus the sessions already planned for any course whose exam comes earlier (FR3.1: one plan per student, nearest exam first).
3. System schedules each unfinished learning action, weakest topics first.
4. System adds a final review session, splitting its time **inversely by mastery** — a topic rated 1 gets far more review time than one rated 5.
5. If the exam allows open material or a formula sheet, System reserves time to prepare those aids.
6. System renders the plan in the Calendar — a weekly time grid, with a month view — where each block is an event at its planned time and opens the topic's details when clicked (FR6.1).

**Alternative flows:**
- *Not enough time for the full plan ("the exam is tomorrow")* — System switches to **emergency mode**: it drops the individual read/summarise/quiz actions and produces one condensed review session split **equally** across topics, and says so.
- *Not enough time even for that* — System reports the plan as infeasible and states how many more free minutes are needed, rather than quietly producing an impossible schedule.
- *Another course's exam comes first* — that course's sessions take the hours first and this course is planned into what remains; if it no longer fits, the emergency or infeasibility outcome is reported for this course specifically, never by squeezing the two together.
- *No exam date set* — System asks for one (400).

**Postcondition:** the Student has concrete time blocks. The plan is recomputed on each request and never stored ([ADR 0005](adr/0005-schedule-not-persisted.md)).

---

## UC8 — Study and record progress

**Requirement:** FR2.4, FR2.5, FR4.2, FR4.3
**Main flow:**
1. Student ticks off a learning action.
2. System moves the topic to In progress on its first completed action.
3. When all three actions are done, System asks the Student to rate their mastery 1–5.
4. System routes the topic by that rating: **Needs review** at 1–2, **Done** at 3–5.

**Alternative flows:**
- *Student drags a card manually* — the manual status wins until real progress (a completed action or a new rating) recomputes it. Dragging is for planning, not for marking work done that wasn't.
- *Student re-rates a topic downward* — it returns to Needs review, and the next generated plan gives it more time.
- *Student opens a card* — the topic's detail view (the same one the Calendar opens from an event) shows its description, status, priority, estimated time, assignee, subtasks and attached materials. Editing there follows the same rules: a manual status change is an override, a topic-level time estimate is split across the subtasks in proportion, and adding or deleting a subtask changes the shared topic for the whole group (FR2.3, FR5.2).

**Postcondition:** the board reflects reality, and the mastery ratings feed straight back into UC7's review split.

---

## UC9 — Track grades and progress

**Requirement:** FR1.3, FR1.4, FR7.1
**Main flow:**
1. Student enters a final grade for a completed course.
2. System computes the weighted average by credit points, per semester and overall — so a 10-credit course counts for more than a 2-credit one.
3. The dashboard shows study velocity: actions completed this week versus last, the weekly average, and the trend in average mastery.

**Postcondition:** the Student can see both academic standing and current study pace across every course at once.

---

## UC10 — Create a study group
**Actors:** Student (owner), other Students, System
**Requirement:** FR5.1
**Main flow:** the owner invites classmates to a course by email; the System notifies them and they join as members.

---

## UC11 — Edit a shared backlog
**Actors:** group members, System
**Requirement:** FR5.2
**Main flow:** any member edits topics, actions, or time estimates, and the change is reflected for everyone — one shared backlog, not a copy each.
**Open design question:** concurrent edits to the same topic need a documented conflict-resolution strategy (see the edge cases in [CLAUDE.md](../CLAUDE.md)).

---

## UC12 — Monitor group progress
**Actors:** group members, System
**Requirement:** FR5.3, FR5.4
**Main flow:** each member sees a coarse completion percentage for every other member — enough for peer motivation.
**Constraint:** grades, time constraints, and personal schedules are never exposed. The data model enforces this by construction rather than by filtering (see [docs/erd.md](erd.md)).

---

## UC13 — Connect and sync Google Calendar

**Requirement:** FR6.2
**Precondition:** Student is signed in; a course has a feasible study plan (UC7).
**Main flow:**
1. Student opens the Calendar and chooses "Connect Google Calendar".
2. System sends the Student to Google's consent screen — a separate consent from Google sign-in ([ADR 0010](adr/0010-google-calendar-sync-via-direct-api.md)); the Student grants access.
3. System stores the credential and creates a calendar named "LearnSprint" in the Student's Google account.
4. Student chooses "Sync now" — for all courses, or for the one the Calendar is filtered to.
5. System recomputes the plan (UC7) and replaces each synced course's sessions in the LearnSprint calendar with it — courses not included in the sync stay as they are.

**Alternative flows:**
- *Consent denied or cancelled* — nothing is stored; the Calendar shows "Not connected".
- *Plan infeasible* — System refuses to sync (409) and shows the same message as UC7; there is nothing sensible to put on a calendar.
- *Google credential expired or revoked* — System reports that a reconnect is needed rather than failing quietly. The LearnSprint Calendar keeps working regardless — Google is a mirror, never the source.
- *Student disconnects* — System removes the LearnSprint calendar from Google (best effort) and discards the credential.

**Postcondition:** the plan is visible in Google Calendar. The LearnSprint Calendar stays the source of truth, and syncing again never duplicates events.

---

## UC14 — Analyse a syllabus into lecture topics

**Requirement:** FR2.7, FR2.10
**Precondition:** the course exists.
**Main flow:**
1. Student picks the syllabus (PDF or PPTX) on the course page and chooses "Analyse syllabus".
2. System stores the file and extracts its text.
3. System proposes roughly one topic per lecture or week — each with a summary, key points and an estimated study time — with Claude when available, otherwise one proposal per heading found by the heuristic.
4. System's matcher marks any proposal that already matches an existing topic of the course.
5. Student reviews the list: renames proposals, drops some, and decides for a matched one whether to attach or create anyway.
6. Student confirms; System creates the new topics (three learning actions and the estimated time each) and files nothing under the ones marked "attach" except a refreshed description.

**Alternative flows:**
- *The structure is unclear* — the proposals are conservative and few rather than invented; the Student can always add topics by hand (FR2.2).
- *Confirming twice* — the second confirmation returns what the first created; no duplicate topics.
- *Every proposal dropped* — nothing is created; the syllabus stays stored as course material.

**Postcondition:** the course has a lecture-level backlog; the syllabus is kept as an uploaded material of the course.
