# Deployment setup

What the GitHub Actions workflows need before they can run, and what is still missing.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | every push and PR | Backend pytest, frontend typecheck + lint + tests. Needs no AWS access — the tests use an in-memory fake for DynamoDB. |
| [`deploy-frontend.yml`](../.github/workflows/deploy-frontend.yml) | push to `main` touching `frontend/`, or manual | Builds the SPA and syncs it to S3, then invalidates CloudFront. |

## Required secrets

Set under **Settings → Secrets and variables → Actions**.

| Secret | Example | Used for |
|---|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::835505308330:role/github-actions-learnsprint` | OIDC role the workflow assumes |
| `S3_BUCKET_NAME` | `learnsprint-frontend` | Where the built site is uploaded |
| `VITE_API_BASE_URL` | `https://abc123.execute-api.il-central-1.amazonaws.com` | Baked into the build so the SPA knows where the API is |
| `CLOUDFRONT_DISTRIBUTION_ID` | `E1234567890ABC` | Optional. Cache invalidation is skipped if unset. |

## The OIDC role

The workflow uses OpenID Connect rather than long-lived access keys, so no AWS secret ever sits in GitHub. This needs a one-time setup in the AWS account:

1. Add GitHub as an OIDC identity provider — URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. Create a role trusting that provider, with the condition restricting it to this repository:
   ```
   "token.actions.githubusercontent.com:sub": "repo:barbh1913/LearnSprint-:ref:refs/heads/main"
   ```
   Without that condition any repository on GitHub could assume the role.
3. Give it only what it needs: `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on the bucket, plus `cloudfront:CreateInvalidation` if using CloudFront.

## What is still missing

**The backend is not deployed.** The frontend workflow ships a static site; the API it calls still only exists on localhost. Deploying the frontend alone produces a site where every page renders and every request fails.

Making the API reachable needs, roughly:

1. **A Lambda adapter.** FastAPI does not speak the Lambda event format. `mangum` wraps the existing app in a handler, so `main.py` gains a handler export but no application or domain code changes.
2. **Packaging.** Dependencies bundled as a zip or container image.
3. **API Gateway** in front, routing to the function.
4. **An execution role** granting DynamoDB access to the `LearnSprint` table.
5. **CORS**, allowing the CloudFront origin — currently the app allows only `localhost:5173`.
6. **`JWT_SECRET` as a real secret**, from Secrets Manager or an encrypted environment variable. The local default must not follow the app to production.

None of this is hard, but it is several hours of real work, and it is honest to say that the deployment story is designed rather than done. The application architecture is ready for it: [ADR 0002](adr/0002-serverless-lambda-over-containers.md) and [ADR 0004](adr/0004-feature-based-backend-organization.md) already shape the backend so each feature module can become its own Lambda with only the entry point changing.
