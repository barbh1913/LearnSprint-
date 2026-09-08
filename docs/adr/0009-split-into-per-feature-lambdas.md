# 0009 — Split into six per-feature Lambdas, with per-user S3 storage for uploads

Supersedes the single-Lambda decision in [ADR 0008](0008-deployed-to-aws.md), realizing the Lambda-per-feature-module target that ADR 0002 and ADR 0004 originally planned.

## Context

ADR 0008 deployed the whole FastAPI app as one Lambda (`learnsprint-api`) to get a working deployment quickly, deliberately deferring the per-feature split ADR 0002 had planned. With the deployment stable, two things prompted revisiting that: Bar wanted the backend to run as genuinely separate Lambdas rather than one function playing every role, with at least one function dedicated to the AI analysis of course material — and wanted uploaded files to actually persist, per student, in S3, with the analysis reading from that stored copy rather than only the transient request body.

## Decision

**Six Lambda functions**, one per bounded concern, sharing one deployment package (`backend/src/lambda_handler.py` now exports six named handlers instead of one; each AWS Lambda function config just points at a different one):

| Function | Routers mounted | Routes |
|---|---|---|
| `learnsprint-auth` | `shared/auth` | `/auth/*`, `/health` |
| `learnsprint-academic-profile` | `academic_profile` | `/courses`, `/grades`, `/constraints`, `/ai-settings` |
| `learnsprint-content-topics` | `content_topics` | `/courses/{id}/topics*` — **the AI-analysis function** |
| `learnsprint-scheduling` | `scheduling` | `/courses/{id}/schedule*` |
| `learnsprint-progress` | `progress` | `/board`, `/sprint`, `/velocity`, `/topics/*/progress`, `/actions/*/progress` |
| `learnsprint-study-groups` | `study_groups` | `/courses/{id}/members*` |

Each function runs a *slim* FastAPI app mounting only its own router — not the whole app six times over. Application, domain, and infrastructure code is completely unchanged; only `lambda_handler.py` (Presentation layer) differs from ADR 0008, exactly as ADR 0004 anticipated.

API Gateway (`smart-study-planner-api`, reused per ADR 0008) now has one exact route per real endpoint (30 total, including `/health`) rather than a single `ANY /{proxy+}` catch-all — each pointing at the integration for the Lambda that owns it. HTTP APIs match literal path segments exactly, so `GET /courses/{id}/schedule` and `GET /courses/{id}/members` route to different functions with no ambiguity, even though both share the `/courses/{id}/...` shape.

**A new, narrower execution role** (`learnsprint-lambda-role`) replaces `lambda_fullAccess` (ADR 0008's reused role) for these six functions. It grants exactly `dynamodb:GetItem/PutItem/DeleteItem/Query` on the `LearnSprint` table (not `AmazonDynamoDBFullAccess`, which covers every table in the account) and `s3:PutObject/GetObject/DeleteObject` on the new uploads bucket alone. The old role stays attached only to the three original Lambdas from the previous project, untouched.

**Uploaded files persist per-student**, in a new private bucket (`learnsprint-uploads-835505308330`), one key per file: `{userId}/{courseId}/{uuid}-{filename}`. There is no per-user *bucket* — S3 has no meaningful per-account limit that would force that, and one bucket with per-user key prefixes is the standard pattern; the isolation is structural the same way DynamoDB's partition-per-user design already works (see `docs/erd.md`), not a filter that could be gotten wrong later.

`content_topics`'s upload endpoint now: reads the upload, **writes it to S3 under the uploader's own prefix, then reads it back from S3** and parses that copy — not the original request bytes — before running AI or heuristic analysis. The extra round-trip is deliberate: it's what makes "the Lambda uses the stored file" true architecturally, not just true of the immediate request, and it means the exact bytes analysed are provably the exact bytes on record for that student.

## Alternatives considered

- **Keep one Lambda, just add S3 storage.** Would have satisfied the storage requirement alone but not "several separate Lambdas, not one" — Bar's explicit ask.
- **A seventh, dedicated "AI analysis" Lambda separate from `content_topics`.** The AI analysis (`ai_extractor.py`) is already one code path inside the `content_topics` feature, invoked from the same endpoint as the heuristic fallback (see the analyser-selection logic in its router) — splitting it into its own function would mean either duplicating the upload-handling and topic-creation logic, or one Lambda calling another synchronously over the network for what's a single logical request. `content_topics` already *is* the AI-analysis function; giving it its own Lambda (done) was enough.
- **Parse from the request body, write to S3 only as a side effect (fire-and-forget).** Simpler and one round-trip cheaper, but weaker: nothing then verifies the stored copy is actually what gets analysed, and a future bug in the write path could silently desync the two. Reading back the stored object closes that gap for the cost of one extra S3 GET per file.
- **Event-driven analysis** (S3 upload triggers the Lambda via a PUT event, asynchronously). More "serverless-native," and worth it if uploads ever need to be re-analysed without re-uploading. Not built now: it needs the frontend to poll or subscribe for a result instead of getting one back synchronously, which is real added complexity for a requirement that only asked for storage and use, not asynchrony.

## Consequences

- **The API's base URL is unchanged** (`https://j6ltiaailc.execute-api.il-central-1.amazonaws.com/prod`) — only what happens behind it changed. The frontend needed no changes and no redeploy for this.
- **Redeploying now means redeploying the function(s) that actually changed**, not always all six — see the updated steps in `docs/deployment-setup.md`. A change to `scheduling`'s domain logic only needs `learnsprint-scheduling` updated; a shared-code change (e.g. `shared/dynamo.py`) needs all six, since they share one package.
- **Six cold starts instead of one.** A request that used to warm a single Lambda for the whole session now potentially cold-starts a different function per feature area touched. Verified acceptable at this traffic level (a few seconds slower on a cold path, same as before) but worth knowing if latency ever matters.
- **The migration was done with a safety net**: the old catch-all route and `learnsprint-api` were only removed after all 30 new routes were verified against the real deployed stack (golden-path and study-groups checks, both re-run with the fallback still in place, then again with it removed). Nothing was cut over blind.
- **A privacy-check script flagged a false positive during verification** (`"97" not in response_body`, where 97 was a test grade) — a random UUID elsewhere in the same response coincidentally contained "97" as a substring. This is the same class of flaky assertion already fixed for real in `tests/test_study_groups.py` (checking parsed field values, not raw text) earlier in the project; the scratchpad script that surfaced it here isn't part of the repository. The actual committed privacy tests, which check structurally rather than by substring, stayed green throughout.
