# Deployment

**Status: live**, and the frontend now redeploys automatically on push once the GitHub secrets below are set. See [ADR 0008](adr/0008-deployed-to-aws.md) for the initial deployment and [ADR 0009](adr/0009-split-into-per-feature-lambdas.md) for splitting it into six per-feature Lambdas with per-student S3 storage for uploads.

| | |
|---|---|
| Frontend | `https://d6dbklbpa5amn.cloudfront.net` |
| API | `https://j6ltiaailc.execute-api.il-central-1.amazonaws.com/prod` |
| Lambdas | `learnsprint-auth`, `-academic-profile`, `-content-topics`, `-scheduling`, `-progress`, `-study-groups` (il-central-1) — one per feature, see ADR 0009 |
| Lambda execution role | `learnsprint-lambda-role` — scoped to the `LearnSprint` table and the uploads bucket only |
| DynamoDB | `LearnSprint` table |
| S3 (frontend) | `learnsprint-frontend-835505308330` |
| S3 (uploads) | `learnsprint-uploads-835505308330` — one key per file, under `{userId}/{courseId}/...` |
| CloudFront | `E2GSBED87C32YJ` |
| API Gateway | `smart-study-planner-api` (`j6ltiaailc`) — reused from the previous project, see ADR 0008; 31 exact routes, one per endpoint |
| CI role | `learnsprint-github-actions` — scoped to this repo only, see below |

## One remaining step: add the GitHub secrets

The AWS side (role, permissions) is done. `deploy-frontend.yml` now triggers on every push to `main` touching `frontend/`, but it **will fail until these secrets exist** — it fails fast with a clear message rather than shipping a broken build, so this is a visible red X, not a silent problem. Add them under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::835505308330:role/learnsprint-github-actions` |
| `S3_BUCKET_NAME` | `learnsprint-frontend-835505308330` |
| `VITE_API_BASE_URL` | `https://j6ltiaailc.execute-api.il-central-1.amazonaws.com/prod` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `E2GSBED87C32YJ` |
| `VITE_COGNITO_DOMAIN` | `il-central-1tahdnpizi.auth.il-central-1.amazoncognito.com` |
| `VITE_COGNITO_CLIENT_ID` | `4gbs8nrr3jqn54iqjd6r3an6hd` |
| `VITE_REDIRECT_URI` | `https://d6dbklbpa5amn.cloudfront.net/callback` |

The `VITE_COGNITO_*` and `VITE_REDIRECT_URI` values are public identifiers, not secrets — they end up in the browser bundle regardless. They live in Secrets only so every environment-specific value is set in one place. `frontend/.env.production` already carries the same values for a local production build.

### The CI role

`learnsprint-github-actions` trusts the account's existing GitHub OIDC provider, but only for this repository:
```
"token.actions.githubusercontent.com:sub": "repo:barbh1913/LearnSprint-:*"
```
It was created fresh rather than reusing the account's other GitHub Actions role (`githubactions-s3-fullaccess`), which is scoped to two unrelated repositories from other coursework — widening someone else's shared role to a third project isn't something to do without asking. Its permissions are equally narrow: `s3:PutObject` / `DeleteObject` / `ListBucket` on `learnsprint-frontend-835505308330` alone, and `cloudfront:CreateInvalidation` on `E2GSBED87C32YJ` alone — nothing else in the account.

## Redeploying by hand

`deploy-frontend.yml` covers the frontend once its secrets are set. The backend has no workflow yet — every backend deploy is still this, run from `backend/`. All six functions share one deployment package, so build it once:

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

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | every push and PR | Backend pytest, frontend typecheck + lint + tests. Needs no AWS access — the tests use an in-memory fake for DynamoDB. |
| [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml) | push to `main` touching `frontend/`, or manual | Builds the SPA and syncs it to S3, then invalidates CloudFront. Needs the secrets above to actually succeed. |

## Known gaps

**No `deploy-backend.yml`.** Backend deploys stay manual (above) until one exists to run the packaging + per-function `update-function-code` steps in CI.

**No custom domain.** The previous project's domain (`study-planner.proj.rotem.click`) doesn't resolve — its Route 53 zone exists in this account but the parent zone doesn't, so there's no delegation (ADR 0008). The app runs on CloudFront's own domain instead.
