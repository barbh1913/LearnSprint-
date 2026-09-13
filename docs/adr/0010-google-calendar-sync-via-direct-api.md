# 0010 — Google Calendar sync through Google's API, alongside the .ics export

Extends the calendar-export decision recorded in `scheduling/domain/calendar_export.py` rather than replacing it, and builds on the Google sign-in decision in [ADR 0007](0007-google-sign-in-via-cognito.md).

## Context

FR6.1 turns the Gantt-style list into a real weekly calendar inside LearnSprint. Bar then wanted the plan to *also* show up in the student's Google Calendar, optionally, without making Google the source of truth.

Two things in the existing design shaped the answer:

- The `.ics` export was chosen deliberately to avoid an OAuth consent flow — it imports into Google, Apple and Outlook alike with no account linking. That reasoning still holds, but an `.ics` file is a snapshot: it has no idea the plan was recomputed after a mastery rating, and importing it twice makes duplicates. "Sync" is a different requirement from "export".
- Google sign-in goes through Cognito (ADR 0007). Cognito keeps the Google tokens to itself and only ever issues Cognito tokens, so the app never holds a Google access token and cannot ask Cognito for a Calendar scope. Calendar access needs its own OAuth client, its own consent, and its own stored credential.

## Decision

**A separate Google OAuth 2.0 client, called directly over REST from the existing `scheduling` Lambda.**

- **The LearnSprint Calendar is primary; Google is a mirror.** The plan is still computed on demand and never stored (ADR 0005). Sync recomputes it and pushes it — it never reads anything back from Google into the schedule.
- **One LearnSprint-owned calendar per student.** On connect, the app creates a secondary calendar named "LearnSprint" in the student's account and stores its id. Every event the app writes is tagged with its course (a private extended property), and a sync **replaces that course's events** — ask Google for the ones carrying that tag, remove them, insert the current plan — so re-syncing is idempotent without any per-event bookkeeping, and syncing one course never touches another course's sessions in the same calendar. Disconnect deletes the calendar. This is also the guarantee that the app never touches the student's own calendars, and it lets the consent ask for the narrowest scope Google offers (`calendar.app.created`, which covers only calendars the app created) rather than blanket access to all events.
- **Google's batch endpoint, 50 calls per request.** A plan is dozens of events; sending them one HTTP round-trip each would make a sync slow and fragile. The batch endpoint turns removal and insertion into a handful of requests, and each part's own status is checked — one rejected event fails the sync loudly rather than leaving a half-written calendar.
- **Manual "Sync now", no background job.** Nothing in the deployment schedules work (no EventBridge, no queue), and adding infrastructure for an optional mirror isn't justified. The trade is that the mirror can go stale between syncs — acceptable, because the student is told when it was last synced and the in-app calendar is always current.
- **It lives in `scheduling`, not a seventh Lambda.** Sync is "compute the plan, send it somewhere" — the same shape as the `.ics` export that already lives there, sharing `build_schedule_for_course` and the same infeasibility rules (an infeasible plan is refused, not synced). The same reasoning ADR 0009 used against a separate AI Lambda applies.
- **Plain HTTP, no Google SDK.** Token exchange, calendar creation and the batch events endpoint are a handful of REST calls; `httpx` (already a dev dependency for tests) becomes a runtime dependency instead of pulling in `google-api-python-client` and its transitive tree for the Lambda package.
- **The credential stays server-side.** The backend builds the authorize URL, so the client id and secret never reach the browser, and the frontend's callback page only forwards Google's one-time code — the same shape as the Cognito callback. The refresh token is stored on a private per-user item (`USER#<id>` / `GOOGLE_CALENDAR`), never returned by any endpoint and never logged, relying on DynamoDB's encryption at rest — the same convention the project already uses for the per-user AI key. Envelope-encrypting it with KMS would be the next step if this were more than a class project; it is noted here as the known gap rather than done.
- **Times are sent with an explicit zone.** The scheduler works in naive wall-clock time (blocked hours are "09:00", not an instant), and the `.ics` export writes floating times for the same reason. Google's API wants a zone, so events are sent as the naive `dateTime` plus `timeZone: "Asia/Jerusalem"` — the same wall-clock semantics, made explicit.

## Alternatives considered

- **Keep only the `.ics` export.** Zero OAuth, zero new infrastructure — but it cannot be a sync: no update on recompute, duplicates on re-import. Kept as the no-Google-account path, not as the answer to this requirement.
- **Ask Cognito for the Calendar scope.** Cognito's Google identity provider can request extra scopes, but the resulting Google tokens are held by Cognito, not exposed to the application, so there is nothing the backend could call the Calendar API with. A direct client is the only way to actually hold the credential.
- **Write into the student's primary calendar with deterministic event ids** (upsert instead of replace). Fewer API calls per sync, but it needs the broad `calendar.events` scope over everything the student has, and any bug becomes a bug in their real calendar. A calendar the app owns outright is safer and easier to reason about, and deleting it on disconnect leaves no trace.
- **Store Google event ids and diff on each sync.** More "correct" in the abstract, but it introduces exactly the stored-and-can-drift state ADR 0005 avoids for the schedule itself. Tagging events and replacing the tagged set is dumber and therefore never wrong — and Google's own filter on private properties means the app never has to remember which events it wrote.
- **Replace the whole calendar on every sync.** Simpler still, but the Calendar page — and the schedule endpoint behind it — is per course, so syncing one course would silently wipe another's sessions from the mirror. Per-course replacement costs one extra filtered list call and keeps courses independent.
- **A background sync (EventBridge schedule or a sync-after-every-change hook).** Would keep the mirror fresh automatically, at the cost of new infrastructure and a Google API call on every board interaction. Not justified for an optional feature; revisit if students actually rely on the mirror.

## Consequences

- **Five new routes, one changed function, no new function.** `learnsprint-scheduling` gains the Google client id/secret/redirect as environment variables — set by hand, since CI only ships code — and the five exact routes are added to API Gateway the same way every other endpoint was (see `docs/deployment-setup.md`).
- **Google's "Testing" publishing status expires refresh tokens after 7 days.** For a class project this is the right trade against Google's verification review, but it means "Connected" can silently become "reconnect needed"; the status endpoint and the Calendar page surface that state explicitly instead of failing on the next sync.
- **A sync is a few batched HTTP calls, not one per block** — a token refresh, one filtered list per page, then one batch per 50 removals and per 50 insertions — so it fits comfortably in the synchronous request the rest of the app uses. The Lambda's timeout was not re-verified for this change and should be checked against real sync durations once the feature is live.
- **`.ics` and Google sync coexist** on the Calendar page: the download is the no-account option, sync is the linked-account option. Neither is a separate view — there is no Gantt page any more.
