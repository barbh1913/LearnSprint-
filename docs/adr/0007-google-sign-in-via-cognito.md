# 0007 — Google sign-in through Cognito, alongside the local login

## Context

The AWS account already had a Cognito user pool with Google configured as an identity provider, left from a previous project, and `http://localhost:5173/callback` was already among its allowed callback URLs. Bar asked for Google sign-in through it.

[ADR 0003](0003-local-first-then-incremental-aws.md) had anticipated exactly this: the local JWT login was built behind a single `get_current_user` dependency so that a Cognito adapter could be added later without touching feature code. This is that addition.

## Decision

Google sign-in is added **alongside** the email/password login, not instead of it.

**Frontend.** "Continue with Google" redirects to the Cognito Hosted UI with PKCE and `identity_provider=Google`. Cognito sends a one-time code back to `/callback`, and the browser exchanges it for tokens directly with Cognito. The **id_token** is what gets stored and sent as the bearer token.

**Backend.** `get_current_user` reads the token's `alg` header. HS256 is one of ours and is checked as before. RS256 is Cognito's: it is verified against the pool's JWKS with audience, issuer and `token_use == "id"` checks, and the user is then looked up — or created — by email.

The id_token rather than the access_token because only the id_token carries `email`, and email is how one person is recognised across both methods: a Google sign-in for an address that already has a password account returns that same account, so a student's courses never split depending on which button they pressed.

## Alternatives considered

- **Replace the local login entirely** — cleaner surface, and what the previous project did. Rejected because it would have invalidated 106 existing API tests that authenticate through `/auth/register`, and because a password login is genuinely useful for demos and grading on a machine with no Google session.
- **Let API Gateway verify the token** (the previous project's approach). Correct in production, but locally there is no gateway — FastAPI is called directly — so the backend must verify for itself anyway. Doing it in the app also means the same code path runs locally and deployed.
- **Send the access_token** — the OAuth-conventional choice, but it has no email claim, which would have forced a second lookup by `sub` and a separate identity-linking scheme for no benefit.

## Consequences

- **Nothing in AWS changed.** The pool, the Google IdP, the app client and its callback URLs were reused exactly as found.
- A user created by Google sign-in has no `passwordHash`. `authenticate_user` rejects a password login for them explicitly instead of crashing on the missing field.
- Logging out of a Google session also hits Cognito's `/logout`; otherwise the next "Continue with Google" would silently sign the same person straight back in.
- The pool's JWKS is fetched once per process and cached. A key rotation would need a restart — acceptable at this scale, and a TTL is the obvious next step if it ever matters.
- Cognito's own hosted-UI users would also pass through this path unchanged, since they receive the same id_token shape. It just isn't exposed in the UI.
- Feature code is unaffected. Every router still depends on `get_current_user` and receives the same user record; none of it knows or cares how the token was produced. That was the point of the seam.
- **The browser-side code exchange has to be idempotent.** React's development `StrictMode` mounts every component twice, and react-router hands out a fresh `navigate` whenever the path changes; either would resend the single-use code, and the second exchange always comes back from Cognito as a 400 that overwrites the first one's success. `CallbackPage` guards the exchange with a ref, and a test rendered under a real `StrictMode` asserts it runs exactly once. This was found the first time a real sign-in was attempted — the flow reached Google, the user picked an account, and the callback showed a 400.
