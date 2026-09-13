# 0011 — One study plan per student, nearest exam first

Refines the schedule described in [ADR 0005](0005-schedule-not-persisted.md) (still computed on demand, never stored) and the Calendar of [ADR 0010](0010-google-calendar-sync-via-direct-api.md).

## Context

The scheduler (FR3.1–FR3.3) has always worked one course at a time: it takes every free window between now and *that course's* exam, removes the student's blocked hours, and fills the windows from the first free minute. Each course was shown on its own page, so nobody noticed that two courses both claim tonight's first free hour.

The Calendar now shows all courses together by default (FR6.1), and Bar's requirement was explicit: real scheduling results per course, and **no overlapping study sessions** when they are combined. Merging the per-course plans in the UI cannot satisfy that — the overlap is structural, not a display problem.

## Decision

**The schedule is one plan per student, built sequentially, nearest exam first.**

- Courses with an exam date are ordered by exam date, earliest first; ties are broken by course name (case-insensitive), then course id, so the order is deterministic and can be explained in one sentence: *the exam that comes first gets first claim on the hours.*
- Each course is scheduled by the **unchanged** FR3.1–3.3 algorithm, with one extra input: the sessions already placed for the courses before it are subtracted from its free windows, exactly the way blocked hours are. No overlaps by construction, and the mastery-weighted allocation, the review session and emergency mode are untouched.
- **Feasibility stays per course and honest.** A later course sees only the time that is actually left. If that is no longer enough, it gets the emergency plan or the infeasibility warning *for that course* — the student is told which exam is starving which, instead of the two plans being quietly squeezed together (edge cases 1 and 3 in CLAUDE.md).
- **The single-course view is a slice of the same plan.** Filtering the Calendar to one course, exporting its `.ics`, or syncing it to Google all use that course's entry from the combined plan. A session sits at the same time in every view; nothing is computed twice with different answers.
- **Nothing is stored** (ADR 0005 still holds). The combined plan is a fold over the courses, computed on demand; there is no cross-course state to invalidate.

## Alternatives considered

- **Merge per-course plans in the Calendar and show overlaps.** Honest about the data, useless as a plan — two sessions at the same hour is precisely the situation a planner exists to prevent.
- **Schedule all courses jointly** (one interleaved allocation across courses, e.g. round-robin or by global mastery weight). More "optimal" on paper, but it changes the graded algorithm's behaviour in ways that are hard to explain — a session moves because a *different* course's mastery rating changed — and it blurs which exam is at risk when time runs short. Sequential by exam date keeps each course's plan recognisably the same algorithm, and the rule is one sentence.
- **Let the student order the courses by hand.** A reasonable later addition, but the nearest exam is the right default and needs no UI to be correct.
- **Keep isolated per-course plans and only fix "All courses".** Then a session would move when the filter changes, and a per-course Google sync would push times the All-courses screen never showed. One plan, sliced, avoids that class of bug entirely.

## Consequences

- **For a student with one course, nothing changes** — the plan is bit-for-bit what the old algorithm produced. With several courses, the later exams' sessions move to stop overlapping, and a course that was "feasible" in isolation may now be honestly reported as tight or infeasible. That is the intended fix, not a regression.
- The per-course schedule endpoint keeps its contract but is now served from the combined plan; a new all-courses endpoint, `.ics` and Google sync follow the Calendar's filter.
- Cost: the combined plan computes every course's allocation even when one is displayed. The allocation is cheap (NFR2 already bounds it under two seconds per course) and the number of courses is small; if that ever changes, the fold can cache per request, not across requests.
- Sprint capacity (FR4.0) is unaffected: it counts free minutes, which do not depend on where sessions are placed.
