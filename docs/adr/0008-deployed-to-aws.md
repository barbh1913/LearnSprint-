# 0008 — Deployed to AWS: Lambda, API Gateway, S3, CloudFront

Supersedes the "not built" status in [docs/deployment-setup.md](../deployment-setup.md) and the target-only diagrams in [docs/diagrams/deployment.md](../diagrams/deployment.md).

## Context

[ADR 0003](0003-local-first-then-incremental-aws.md) deliberately sequenced the features before the infrastructure. With the core features, Study Groups, and Google sign-in all working locally against real AWS services (DynamoDB, Cognito), the remaining step was standing up the deployment itself.

A survey of the AWS account found reusable infrastructure from a previous project: an IAM role (`lambda_fullAccess`, with `AmazonDynamoDBFullAccess` already attached) and an API Gateway HTTP API (`smart-study-planner-api`) with three routes for that project's own Lambdas. Bar's direction: reuse what's reusable for the backend, create fresh for the frontend.

## Decision

**Backend** — a new Lambda function, `learnsprint-api`, running the existing FastAPI app unchanged behind `mangum` (`backend/src/lambda_handler.py`). It uses the existing `lambda_fullAccess` role rather than a new one, and is wired into the existing API Gateway via one added route (`ANY /{proxy+}`, no authorizer — see below) rather than a new API. The old project's three Lambdas and their routes are untouched.

**Frontend** — a new S3 bucket (`learnsprint-frontend-835505308330`) and a new CloudFront distribution, both created fresh rather than reusing the previous project's. That project's custom domain (`study-planner.proj.rotem.click`) turned out to be unreachable: its Route 53 hosted zone exists in this account, but the parent zone (`rotem.click`) does not, so there is no NS delegation and the domain never resolves. The new deployment uses CloudFront's own `*.cloudfront.net` domain instead.

**No custom authorizer.** The API Gateway already had a JWT authorizer configured for the old project, validating Cognito tokens only. It was **not** attached to the new route. The app supports two login methods (local JWT and Cognito, see [ADR 0007](0007-google-sign-in-via-cognito.md)) and validates both itself; an API-Gateway-level Cognito-only authorizer would have silently locked out every user who signed up with a password instead of Google.

## What went wrong, and what it taught

Three real bugs surfaced during deployment, in order:

1. **`No package metadata was found for email-validator`.** The Lambda zip was built by installing dependencies with `pip install --target`, then deliberately deleting every `*.dist-info` directory to shrink the package. Pydantic's `EmailStr` checks for `email-validator` via `importlib.metadata` at import time — deleting its metadata doesn't just save space, it makes the package invisible to code that was never touched. Fixed by leaving `dist-info` alone; the resulting zip (44MB) was still well under Lambda's 50MB direct-upload limit, so the space saving bought nothing anyway.

2. **A bare 401 from `/auth/me` after a real Google sign-in succeeded all the way to Cognito.** Cognito's `id_token` carries an `at_hash` claim, which binds it to an `access_token` the frontend never sends us. `python-jose` refuses to verify a token with `at_hash` unless given that access_token, and fails the whole verification rather than just skipping the one check. Fixed with `options={"verify_at_hash": False}` in `verify_id_token` — there is nothing to compare it against by design, so there was never anything to verify. This also motivated logging *why* a Cognito token is rejected (never the token itself), since a generic 401 gave no way to tell this apart from a genuine bad token.

3. **CORS: `Failed to fetch` from the real frontend, despite `CORSMiddleware` listing the CloudFront origin correctly.** The existing API Gateway HTTP API turned out to already have its **own** API-level CORS configuration from the old project (`AllowOrigins: [study-planner.proj.rotem.click]`). An HTTP API with API-level CORS configured takes over CORS entirely for every route on the API and overrides whatever the Lambda integration returns — so FastAPI's `Access-Control-Allow-Origin` header was computed correctly and then silently discarded before reaching the browser. Confirmed by invoking the Lambda directly (bypassing API Gateway), which showed the correct header, versus the real HTTPS path, which didn't. Fixed by updating the API Gateway's CORS config to include the new origins alongside the old one, rather than removing FastAPI's own CORS handling — the app still needs it to behave correctly when run locally, where there is no API Gateway.

4. **`/prod/api/auth/register` returned 404.** `frontend/src/api/client.ts` unconditionally prefixed every request path with `/api`, which is a Vite-dev-proxy convention (`/api/*` → strip `/api` → `localhost:8000/*`), not a real backend route. Locally this was invisible because the dev server was doing the stripping; in production, with `VITE_API_BASE_URL` pointing straight at API Gateway, the prefix became part of the actual request path and matched nothing. Fixed with an `apiUrl()` helper that only adds `/api` when `VITE_API_BASE_URL` is unset.

None of these were caught by the 106 backend tests or the frontend suite — all four are specifically about the seam between the app and its deployment environment, which local tests, by construction, don't cross. That's not a gap to close by testing more use of mocks; it's why the golden-path script was rerun against the real deployed stack (`/prod/...`, and separately in the browser) as the actual verification, the same way it was first used against local dev.

## Consequences

- **The full stack is live**: frontend at `https://d6dbklbpa5amn.cloudfront.net`, API at `https://j6ltiaailc.execute-api.il-central-1.amazonaws.com/prod`. Both were driven through a real sign-up, course creation, and deletion in the browser as the final check, not just curl.
- **The frontend now redeploys automatically on push**, once its GitHub secrets are set (see [docs/deployment-setup.md](../deployment-setup.md)). It runs under a new role, `learnsprint-github-actions`, scoped by trust policy to this repository alone — the existing `githubactions-s3-fullaccess` role is scoped to two unrelated repositories and was deliberately not widened to include this one. **The backend still deploys by hand** — there is no `deploy-backend.yml`.
- **The API Gateway's CORS configuration is now shared state** between the old project and this one. Removing an origin from it, or the old project's Lambdas, is out of scope here and wasn't done.
- `JWT_SECRET` in the Lambda's environment is a real generated value, not the local dev default — it exists only in the Lambda configuration and was never committed.
