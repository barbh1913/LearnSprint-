# 0014 — Cognito as the single identity provider

Supersedes the "alongside" half of [ADR 0007](0007-google-sign-in-via-cognito.md): Google sign-in still goes through Cognito exactly as decided there, but the email/password login now lives in the same user pool instead of in DynamoDB.

## Context

ADR 0007 added Google sign-in next to a home-grown email/password login: bcrypt hashes in the `USER` row, verified by the app itself. That was the quickest way to get Google in without touching the tests, but it left two authentication systems side by side — and the features a real account needs beyond "log in" (forgot password, change password, delete account) would each have had to be built twice, once per system, with the reset-code emailing written from scratch.

Bar asked for one provider, and for those three account features.

## Decision

**Cognito holds every credential; DynamoDB holds only the LearnSprint profile and the academic data.**

- **Registration and login call Cognito.** `shared/auth/cognito_users.py` is a thin boto3 adapter: `admin_create_user` + `admin_set_user_password` for sign-up (no verification email — the account is usable at once, as before), `initiate_auth` with `USER_PASSWORD_AUTH` for login, `forgot_password` / `confirm_forgot_password` for the reset flow, `admin_set_user_password` after a verified `initiate_auth` for a change, `list_users` + `admin_delete_user` for deletion. Nothing else in the backend imports boto3's Cognito client.
- **The app still issues its own session token.** After Cognito accepts the credentials, the backend mints the same HS256 JWT it always has, and `get_current_user` is unchanged. This keeps the Google path (RS256 id_token, verified against the pool's JWKS) and the password path converging on the one `_resolve_user` seam, and it keeps the browser, the API client and 290+ tests exactly as they were.
- **`passwordHash` is gone.** The `USER` item is `id`, `email`, `createdAt`. `passlib` and `bcrypt` leave the dependency list.
- **One email, one account, in both places.** A Google user is a federated Cognito user (`google_…` username) with an email; a password user is a native Cognito user with the same email attribute. The LearnSprint profile is found or created by email whichever way the person arrived, as in ADR 0007. Cognito keeps them as two pool entries — linking them into one is possible (`AdminLinkProviderForUser`) but adds a step that has to happen before the first Google login, so it is not done; the app-level identity is what matters and that is already shared.
- **Forgot / change / delete are endpoints of `shared/auth`**: `POST /auth/forgot-password` (always 204 — never reveals whether the email exists), `POST /auth/reset-password`, `POST /auth/change-password` (signed in; 400 for a Google-only account, which has no password), `DELETE /auth/me` with the literal `confirm: "DELETE"` in the body.
- **Deletion removes the data first, then the Cognito user.** `academic_profile/application/account_deletion.py` deletes courses the student owns (for every member, including their progress and materials — the same routine `DELETE /courses/{id}` uses), the student's own materials in courses they merely joined, the Google Calendar connection (and the app's calendar in Google, best effort), and finally every row in the student's partition. If Cognito then fails, the person can still sign in and try again; the reverse order could leave data nobody can reach.

## Alternatives considered

- **Keep both systems and add the three features to each.** Twice the code, and a hand-rolled reset-code flow with its own email delivery. Rejected — this is the situation the decision removes.
- **Use Cognito's tokens everywhere and drop the app's own JWT.** Cleaner on paper, but the hosted-UI PKCE flow would then have to serve password users too (or the SRP flow be implemented in the browser), every test would have to mint RS256 tokens, and nothing the student sees would improve. Deferred; the seam in `_resolve_user` makes it a contained change if it is ever wanted.
- **Link the Google and native Cognito users.** See above — correct in principle, but it must run before the first federated login for that email, which means intercepting Cognito's pre-sign-up trigger. Out of proportion for the project; the app-level identity is already one.

## Consequences

- **Existing password accounts must register again.** Their DynamoDB profile and data survive (the profile is matched by email on the first new registration), but Cognito has never seen their password. There is no migration path for bcrypt hashes and none is attempted; the app has a handful of users and Bar is one of them.
- **Cognito configuration is now required for the password login**, not only for Google: the app client needs `ALLOW_USER_PASSWORD_AUTH`, the Lambda role needs the five `cognito-idp` admin permissions on the pool, and the pool sends the reset-code emails (its default sender is enough at this scale). Without the pool id and client id every auth endpoint answers 503. See `docs/deployment-setup.md`.
- **Cognito's password policy applies** on top of the app's 8-character minimum; its message is passed through to the student when it rejects a password.
- **Tests stay offline.** `conftest.py` swaps the adapter for a dict-backed `FakeCognito`, the same way DynamoDB and S3 are faked.
