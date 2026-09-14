# Deployment

**Status: live**, and both the frontend and the six backend Lambdas now redeploy automatically on push once the GitHub secrets below are set. See [ADR 0008](adr/0008-deployed-to-aws.md) for the initial deployment and [ADR 0009](adr/0009-split-into-per-feature-lambdas.md) for splitting it into six per-feature Lambdas with per-student S3 storage for uploads.

| | |
|---|---|
| Frontend | `https://d6dbklbpa5amn.cloudfront.net` |
| API | `https://j6ltiaailc.execute-api.il-central-1.amazonaws.com/prod` |
| Lambdas | `learnsprint-auth`, `-academic-profile`, `-content-topics`, `-scheduling`, `-progress`, `-study-groups` (il-central-1) — one per feature, see ADR 0009 |
| Lambda execution role | `learnsprint-lambda-role` — scoped to the `LearnSprint` table, the uploads bucket, and the Cognito user pool's admin user operations (see below) |
| Cognito user pool | `il-central-1_tahdnpizi` (app client `4gbs8nrr3jqn54iqjd6r3an6hd`) — every account, password and Google alike, see [ADR 0014](adr/0014-cognito-as-the-single-identity-provider.md) |
| DynamoDB | `LearnSprint` table |
| S3 (frontend) | `learnsprint-frontend-835505308330` |
| S3 (uploads) | `learnsprint-uploads-835505308330` — one key per file, under `{userId}/{courseId}/...` |
| CloudFront | `E2GSBED87C32YJ` |
| API Gateway | `smart-study-planner-api` (`j6ltiaailc`) — reused from the previous project, see ADR 0008; 31 exact routes, one per endpoint, plus the ones added since (7 for the Calendar and Google sync, 6 for subtasks and materials, 4 for AI content analysis, 4 for account management — see below; the 2 `/ai-settings` routes are obsolete) |
| CI role | `learnsprint-github-actions` — scoped to this repo only, see below |

## One remaining step: add the GitHub secrets

The AWS side (role, permissions) is done. `deploy-frontend.yml` triggers on every push to `main` touching `frontend/`, and `deploy-backend.yml` on every push touching `backend/` — both **will fail until these secrets exist** (the frontend one fails fast with a clear message rather than shipping a broken build; the backend one just can't assume the role). Add them under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::835505308330:role/learnsprint-github-actions` |
| `S3_BUCKET_NAME` | `learnsprint-frontend-835505308330` |
| `VITE_API_BASE_URL` | `https://j6ltiaailc.execute-api.il-central-1.amazonaws.com/prod` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `E2GSBED87C32YJ` |
| `VITE_COGNITO_DOMAIN` | `il-central-1tahdnpizi.auth.il-central-1.amazoncognito.com` |
| `VITE_COGNITO_CLIENT_ID` | `4gbs8nrr3jqn54iqjd6r3an6hd` |
| `VITE_REDIRECT_URI` | `https://d6dbklbpa5amn.cloudfront.net/callback` |
| `SYSTEM_ANTHROPIC_API_KEY` | your own Anthropic key (starts `sk-ant-...`) — optional, see [AI content analysis](#ai-content-analysis-fr27-fr28-fr210--one-variable-four-routes) below |
| `GOOGLE_CALENDAR_CLIENT_ID` | the Google OAuth client id (ends `.apps.googleusercontent.com`) — optional, see [Google Calendar sync](#google-calendar-sync-fr62--one-time-manual-setup) below |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | its client secret (starts `GOCSPX-`) — optional, same section |

The `VITE_COGNITO_*` and `VITE_REDIRECT_URI` values are public identifiers, not secrets — they end up in the browser bundle regardless. They live in Secrets only so every environment-specific value is set in one place. `frontend/.env.production` already carries the same values for a local production build.

### The CI role

`learnsprint-github-actions` trusts the account's existing GitHub OIDC provider, but only for this repository:
```
"token.actions.githubusercontent.com:sub": "repo:barbh1913/LearnSprint-:*"
```
It was created fresh rather than reusing the account's other GitHub Actions role (`githubactions-s3-fullaccess`), which is scoped to two unrelated repositories from other coursework — widening someone else's shared role to a third project isn't something to do without asking. Its permissions are two separate inline policies, each as narrow as the job it's for:
- `deploy-frontend`: `s3:PutObject` / `DeleteObject` / `ListBucket` on `learnsprint-frontend-835505308330` alone, and `cloudfront:CreateInvalidation` on `E2GSBED87C32YJ` alone.
- `deploy-backend-lambdas`: `lambda:UpdateFunctionCode` / `GetFunction` / `GetFunctionConfiguration` / `UpdateFunctionConfiguration`, scoped to exactly the six function ARNs above and nothing else in the account. `UpdateFunctionConfiguration` is what the two environment-sync steps (Anthropic key, Google Calendar client) need; as of 2026-09-14 the policy in the account still lacks it, so those steps fail with `AccessDenied` until it is added:
  ```
  aws iam put-role-policy --role-name learnsprint-github-actions --policy-name deploy-backend-lambdas --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode","lambda:GetFunction","lambda:GetFunctionConfiguration","lambda:UpdateFunctionConfiguration"],"Resource":["arn:aws:lambda:il-central-1:835505308330:function:learnsprint-auth","arn:aws:lambda:il-central-1:835505308330:function:learnsprint-academic-profile","arn:aws:lambda:il-central-1:835505308330:function:learnsprint-content-topics","arn:aws:lambda:il-central-1:835505308330:function:learnsprint-scheduling","arn:aws:lambda:il-central-1:835505308330:function:learnsprint-progress","arn:aws:lambda:il-central-1:835505308330:function:learnsprint-study-groups"]}]}'
  ```

## Redeploying by hand

`deploy-frontend.yml` and `deploy-backend.yml` cover both halves once the secrets are set - this section is for when a manual deploy is faster than waiting on CI, or for debugging a failed run. Run from `backend/`. All six functions share one deployment package, so build it once:

**A brand new endpoint also needs a new API Gateway route** — the exact-route strategy (ADR 0009) means `update-function-code` alone isn't enough; a route that doesn't exist yet 404s no matter what the Lambda code does:
```
aws apigatewayv2 create-route --api-id j6ltiaailc --route-key "PATCH /courses/{course_id}/topics/{topic_id}/actions/{action_id}" --target integrations/<the feature's integration id>
```
Find the right integration id by copying it from another route already pointing at that same Lambda (`aws apigatewayv2 get-routes --api-id j6ltiaailc`). HTTP APIs apply route changes to `$default` immediately — no separate deploy step.

```
rm -rf build/lambda-package build/lambda-deploy.zip
pip install --platform manylinux2014_x86_64 --python-version 3.13 --implementation cp --abi cp313 \
  --only-binary=:all: --target build/lambda-package ".[lambda]"
cp src/main.py src/lambda_handler.py build/lambda-package/
cd build/lambda-package && find . -name "__pycache__" -type d -exec rm -rf {} +
# zip build/lambda-package's contents (not the folder itself) into ../lambda-deploy.zip
```

Then update whichever function(s) actually changed — no need to redeploy all six for, say, a `scheduling`-only fix:

```
aws lambda update-function-code --function-name learnsprint-scheduling --zip-file fileb://build/lambda-deploy.zip
```

Function names: `learnsprint-auth`, `learnsprint-academic-profile`, `learnsprint-content-topics`, `learnsprint-scheduling`, `learnsprint-progress`, `learnsprint-study-groups`. A change to anything under `shared/` needs all six, since they all import it from the same package.

Do **not** delete `*.dist-info` directories to save space — `email-validator`'s metadata lives there and Pydantic needs it at runtime (ADR 0008, bug #1).

The same frontend steps `deploy-frontend.yml` runs, done by hand (from `frontend/`), for when a manual deploy is faster than waiting on CI:
```
npm run build   # picks up .env.production automatically
aws s3 sync dist s3://learnsprint-frontend-835505308330 --delete --cache-control "max-age=31536000,immutable" --exclude "index.html"
aws s3 cp dist/index.html s3://learnsprint-frontend-835505308330/index.html --cache-control "no-cache,no-store,must-revalidate"
aws cloudfront create-invalidation --distribution-id E2GSBED87C32YJ --paths "/index.html"
```
Only `index.html` needs invalidating — every other asset is content-hashed, so a code change always produces a new filename.

## Google Calendar sync (FR6.2) — one-time manual setup

The code is already deployed with every backend push; what is missing until this is done is the Google OAuth client, which only you can create. Until then the Calendar page hides the Google controls (`GET /integrations/google-calendar/status` answers `configured: false`). See [ADR 0010](adr/0010-google-calendar-sync-via-direct-api.md) for why this is a separate Google OAuth client rather than the Cognito sign-in.

**1. Google Cloud console** (any project — a new one is fine):
- APIs & Services → Library → enable **Google Calendar API**.
- OAuth consent screen: user type **External**, publishing status **Testing**, and add the Google accounts that will use it (yours, any grader) as **test users**. Scope: `https://www.googleapis.com/auth/calendar.app.created` if the console offers it (only calendars the app itself created — a non-sensitive scope); otherwise `https://www.googleapis.com/auth/calendar.events`.
- Credentials → Create credentials → **OAuth client ID → Web application**. Authorized redirect URIs: `http://localhost:5173/calendar/google/callback` and `https://d6dbklbpa5amn.cloudfront.net/calendar/google/callback`. Keep the client id and secret.
- Known limitation of **Testing** status: Google expires refresh tokens after **7 days**, so a connected student has to reconnect weekly. Publishing to Production removes that but sends the app through Google's verification review — not worth it for a class project.

**2. GitHub secrets** — add `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` (table above). `deploy-backend.yml` merges them, together with the fixed production redirect URI, into `learnsprint-scheduling`'s environment on every backend deploy — the same way it syncs the Anthropic key. To apply them without a code change, run the workflow by hand: **Actions → Deploy backend to Lambda → Run workflow**. Nothing is set on the Lambda directly. For local development the same values, with the `localhost` redirect URI, go in `backend/.env`.

**3. API Gateway routes** — seven new exact routes, all pointing at the `learnsprint-scheduling` integration (copy its id from the existing `GET /courses/{course_id}/schedule` route). The first two are the all-courses Calendar (FR3.1/FR6.1) and are needed even without Google; the rest are the sync:
```
GET    /schedule
GET    /schedule.ics
GET    /integrations/google-calendar/status
GET    /integrations/google-calendar/authorize
POST   /integrations/google-calendar/callback
POST   /integrations/google-calendar/sync
DELETE /integrations/google-calendar/connection
```
`POST /integrations/google-calendar/sync` takes an optional `courseId` query parameter; without it every course with a plan is synced.
Nothing changes on the frontend side — the backend builds the Google authorize URL, so the client id and secret never reach the browser and no new `VITE_` variable is needed.

## AI content analysis (FR2.7, FR2.8, FR2.10) — one variable, four routes

AI is a backend capability ([ADR 0013](adr/0013-content-intelligence-pipeline.md)); there is nothing per student to configure any more, and the old `GET/PUT /ai-settings` routes can be deleted from API Gateway.

**1. The key** — set the `SYSTEM_ANTHROPIC_API_KEY` GitHub secret (see the table above) and `deploy-backend.yml`'s last step syncs it onto `learnsprint-content-topics` (the only function that calls Anthropic) on every backend deploy - no manual AWS CLI step needed. That step reads the function's current environment and merges the key in with `jq`, so it never clobbers `DYNAMO_TABLE`/`UPLOADS_BUCKET`. Put the same value in `backend/.env` for local development. **Set a spending limit on the key in the Anthropic console**: it now serves every student's upload. Leaving the secret unset is safe - the sync step is skipped and every upload uses the keyword heuristic.

To set or change it by hand instead of through CI:
```
aws lambda update-function-configuration --function-name learnsprint-content-topics --environment "Variables={SYSTEM_ANTHROPIC_API_KEY=sk-ant-...}"
```
As with the Google variables, `--environment` replaces the whole map - include whatever the function already has.

**2. Routes** — four new exact routes on the `learnsprint-content-topics` integration:
```
POST /courses/{course_id}/materials/analyze
POST /courses/{course_id}/materials/{material_id}/confirm
POST /courses/{course_id}/syllabus/analyze
POST /courses/{course_id}/syllabus/confirm
```

## Subtasks and materials (FR2.3, FR2.9) — routes only

The task model (ADR 0012) adds six exact routes, all pointing at the existing `learnsprint-content-topics` integration (copy its id from the `POST /courses/{course_id}/topics` route). No new function, variable or bucket: materials use the existing uploads bucket, and download links are presigned by the Lambda's own role, which already has `s3:GetObject` on it.
```
POST   /courses/{course_id}/topics/{topic_id}/actions
DELETE /courses/{course_id}/topics/{topic_id}/actions/{action_id}
POST   /courses/{course_id}/topics/{topic_id}/materials
GET    /courses/{course_id}/topics/{topic_id}/materials
GET    /courses/{course_id}/topics/{topic_id}/materials/{material_id}/download
DELETE /courses/{course_id}/topics/{topic_id}/materials/{material_id}
```

## Direct-to-S3 uploads — one route, one bucket setting

API Gateway HTTP APIs cap a request body around 10MB, and a synchronous Lambda invoke around 6MB - both well below the app's own 20MB/15-file allowance (FR2.1), so a realistic upload used to fail with 413. The browser now PUTs the file straight to S3 through a short-lived presigned URL; every upload-accepting endpoint (`topics/extract`, `materials/analyze`, `syllabus/analyze`, `topics/{topic_id}/materials`) takes a `{key, fileName}` JSON reference instead of the file bytes, and re-fetches from S3 to validate size and ownership.

**1. Route** — one more exact route on the `learnsprint-content-topics` integration:
```
POST /courses/{course_id}/materials/upload-url
```

**2. Bucket CORS** — a cross-origin browser `PUT` needs the bucket's permission, even with a valid presigned URL:
```
aws s3api put-bucket-cors --bucket learnsprint-uploads-835505308330 --cors-configuration file://cors.json
```
where `cors.json` is:
```json
{"CORSRules": [{"AllowedOrigins": ["https://d6dbklbpa5amn.cloudfront.net", "http://localhost:5173"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3000}]}
```
Add any other origin (a second local dev port, a custom domain) to `AllowedOrigins` the same way. No new function, variable, or IAM permission - the presigned URL is generated by the Lambda's own role, which already has S3 access for the existing download links.

## Cognito as the single identity provider (ADR 0014) — one-time manual setup

Password accounts now live in the user pool too, so the pool is required for every sign-in, not only Google. Three things to set by hand; `deploy-backend.yml` ships the code as usual.

**1. App client** `4gbs8nrr3jqn54iqjd6r3an6hd` — enable the `ALLOW_USER_PASSWORD_AUTH` flow (login and the current-password check call `InitiateAuth` with it), keeping the flows it already has:
```
aws cognito-idp update-user-pool-client --user-pool-id il-central-1_tahdnpizi --client-id 4gbs8nrr3jqn54iqjd6r3an6hd --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH
```
(`--explicit-auth-flows` replaces the list — check `aws cognito-idp describe-user-pool-client` first and include whatever is already enabled.) The client must have **no client secret**; the hosted-UI client used for Google already has none.

**2. Lambda role** `learnsprint-lambda-role` — an inline policy on the pool, for the admin calls the adapter makes (`learnsprint-auth` is the only function that calls them, but all six share the role):
```
{
  "Effect": "Allow",
  "Action": [
    "cognito-idp:AdminCreateUser",
    "cognito-idp:AdminSetUserPassword",
    "cognito-idp:AdminDeleteUser",
    "cognito-idp:ListUsers"
  ],
  "Resource": "arn:aws:cognito-idp:il-central-1:835505308330:userpool/il-central-1_tahdnpizi"
}
```
`InitiateAuth`, `ForgotPassword` and `ConfirmForgotPassword` are unauthenticated client calls and need no IAM permission.

**3. Environment** — `learnsprint-auth` must have `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` and `COGNITO_REGION` (the other five functions already need the first two to verify Google tokens; check with `aws lambda get-function-configuration --function-name learnsprint-auth --query Environment`). Without them every `/auth` endpoint answers 503.

**Reset-code emails** are sent by the pool itself. The default Cognito sender (50 emails/day) is enough at this scale; the pool's *Messaging* tab is where to switch to SES if it ever isn't. The pool's password policy applies on top of the app's 8-character minimum — its message is shown to the student as-is.

**Routes** — four new exact routes on the `learnsprint-auth` integration (copy its id from `POST /auth/login`):
```
POST   /auth/forgot-password
POST   /auth/reset-password
POST   /auth/change-password
DELETE /auth/me
```

**Existing password accounts** created before this change have to register again with the same email: their profile and data are kept (matched by email), but Cognito never saw their password and bcrypt hashes cannot be imported. The old `passwordHash` attribute on `USER` rows is simply ignored and can be left in place.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | every push and PR | Backend pytest, frontend typecheck + lint + tests. Needs no AWS access — the tests use an in-memory fake for DynamoDB. |
| [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml) | push to `main` touching `frontend/`, or manual | Builds the SPA and syncs it to S3, then invalidates CloudFront. Needs the secrets above to actually succeed. |
| [`deploy-backend.yml`](../.github/workflows/deploy-backend.yml) | push to `main` touching `backend/`, or manual | Runs `pytest` as a gate, packages the shared deployment zip, then updates all six Lambda functions and waits for each to finish. Redeploys all six every time rather than tracking which feature(s) changed - simpler, and a `shared/` change needs all six anyway. |

## Known gaps

**No custom domain.** The previous project's domain (`study-planner.proj.rotem.click`) doesn't resolve — its Route 53 zone exists in this account but the parent zone doesn't, so there's no delegation (ADR 0008). The app runs on CloudFront's own domain instead.
