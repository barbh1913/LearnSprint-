# Deployment

**Status: live.** See [ADR 0008](adr/0008-deployed-to-aws.md) for how it got there, what was reused from the previous project, and four real bugs the deployment surfaced that local testing couldn't have caught.

| | |
|---|---|
| Frontend | `https://d6dbklbpa5amn.cloudfront.net` |
| API | `https://j6ltiaailc.execute-api.il-central-1.amazonaws.com/prod` |
| Lambda | `learnsprint-api` (il-central-1) |
| DynamoDB | `LearnSprint` table |
| S3 (frontend) | `learnsprint-frontend-835505308330` |
| CloudFront | `E2GSBED87C32YJ` |
| API Gateway | `smart-study-planner-api` (`j6ltiaailc`) — reused from the previous project, see ADR 0008 |

## Redeploying after a code change

There is no CI pipeline for this yet (see "Not yet automated" below) — every deploy is these commands, run from `backend/`.

**Backend:**
```
rm -rf build/lambda-package build/lambda-deploy.zip
pip install --platform manylinux2014_x86_64 --python-version 3.13 --implementation cp --abi cp313 \
  --only-binary=:all: --target build/lambda-package ".[lambda]"
cp src/main.py src/lambda_handler.py build/lambda-package/
cd build/lambda-package && find . -name "__pycache__" -type d -exec rm -rf {} +
# zip build/lambda-package's contents (not the folder itself) into ../lambda-deploy.zip
aws lambda update-function-code --function-name learnsprint-api --zip-file fileb://build/lambda-deploy.zip
```

Do **not** delete `*.dist-info` directories to save space — `email-validator`'s metadata lives there and Pydantic needs it at runtime (ADR 0008, bug #1).

**Frontend** (from `frontend/`):
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
| [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml) | manual only | Builds the SPA and syncs it to S3, then invalidates CloudFront. Not wired to run automatically yet — see below. |

## Not yet automated

**No CI role for this repository.** The account has a GitHub OIDC provider and a role (`githubactions-s3-fullaccess`) already set up for CI deploys — but its trust policy is scoped to two other repositories (`YVC-CloudDev/bar-weekly-assignment-4`, `YVC-CloudDev/smart-study-planner`), not this one. Widening someone else's shared role to a third repository, or reusing credentials trusted for other projects, wasn't done. A role scoped to `repo:barbh1913/LearnSprint-:*` needs to be created before `deploy-frontend.yml` can run unattended, following the same reasoning as the trust-policy restriction below.

**Backend deploys are entirely manual** — `deploy-frontend.yml` only handles the frontend. A `deploy-backend.yml` doing the packaging steps above doesn't exist yet.

**No custom domain.** The previous project's domain (`study-planner.proj.rotem.click`) doesn't resolve — its Route 53 zone exists in this account but the parent zone doesn't, so there's no delegation (ADR 0008). The app runs on CloudFront's own domain instead.

## Required secrets, once the CI role exists

Set under **Settings → Secrets and variables → Actions**.

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | the new repo-scoped role's ARN, once created |
| `S3_BUCKET_NAME` | `learnsprint-frontend-835505308330` |
| `VITE_API_BASE_URL` | `https://j6ltiaailc.execute-api.il-central-1.amazonaws.com/prod` |
| `CLOUDFRONT_DISTRIBUTION_ID` | `E2GSBED87C32YJ` |
| `VITE_COGNITO_DOMAIN` | `il-central-1tahdnpizi.auth.il-central-1.amazoncognito.com` |
| `VITE_COGNITO_CLIENT_ID` | `4gbs8nrr3jqn54iqjd6r3an6hd` |
| `VITE_REDIRECT_URI` | `https://d6dbklbpa5amn.cloudfront.net/callback` |

The `VITE_COGNITO_*` and `VITE_REDIRECT_URI` values are public identifiers, not secrets — they end up in the browser bundle regardless. They live in Secrets only so every environment-specific value is set in one place. `frontend/.env.production` already carries the same values for a local production build, since none of them need hiding.

### Creating the CI role, when ready

1. Create a role trusting the existing OIDC provider, restricted to this repository:
   ```
   "token.actions.githubusercontent.com:sub": "repo:barbh1913/LearnSprint-:ref:refs/heads/main"
   ```
2. Grant it only what it needs: `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `learnsprint-frontend-835505308330`, plus `cloudfront:CreateInvalidation` on `E2GSBED87C32YJ`.
3. Restore the automatic trigger in `deploy-frontend.yml` (commented out in the file, with the exact lines to uncomment).
