// The OAuth `state` nonce lives in sessionStorage between leaving for Google's
// consent screen and landing back on the callback page - the same trick the
// Cognito sign-in uses for its PKCE verifier. If what comes back doesn't match,
// the code didn't originate from this browser and is ignored.

const STATE_KEY = 'learnsprint.google_calendar_state'

export function rememberState(state: string): void {
  sessionStorage.setItem(STATE_KEY, state)
}

/** Reads and clears the nonce - it is single-use, like the code it protects. */
export function takeState(): string | null {
  const state = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  return state
}
