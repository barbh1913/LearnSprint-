// Cognito Hosted UI with PKCE. Google is configured as an identity provider on
// the user pool, so "Continue with Google" is a redirect to Cognito with
// identity_provider=Google - the OAuth exchange with Google happens over there,
// and we get back a one-time code on /callback.
//
// All three values come from the environment. Without them the Google button is
// hidden and the app is email/password only.

const DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI as string | undefined

const VERIFIER_KEY = 'learnsprint.pkce_verifier'

export const cognitoConfigured = Boolean(DOMAIN && CLIENT_ID && REDIRECT_URI)

export interface CognitoTokens {
  id_token: string
  access_token: string
  refresh_token?: string
  expires_in: number
}

function config() {
  if (!DOMAIN || !CLIENT_ID || !REDIRECT_URI) {
    throw new Error('Cognito is not configured')
  }
  return { DOMAIN, CLIENT_ID, REDIRECT_URI }
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

/** Send the browser to Cognito with Google pre-selected, so the user skips the chooser. */
export async function redirectToGoogleSignIn(): Promise<void> {
  const { DOMAIN, CLIENT_ID, REDIRECT_URI } = config()
  const { verifier, challenge } = await generatePkce()
  sessionStorage.setItem(VERIFIER_KEY, verifier)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: REDIRECT_URI,
    identity_provider: 'Google',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  window.location.href = `https://${DOMAIN}/oauth2/authorize?${params}`
}

/** Trade the one-time code from /callback for tokens. The verifier proves it's the same browser. */
export async function exchangeCodeForTokens(code: string): Promise<CognitoTokens> {
  const { DOMAIN, CLIENT_ID, REDIRECT_URI } = config()
  const verifier = sessionStorage.getItem(VERIFIER_KEY) ?? ''
  sessionStorage.removeItem(VERIFIER_KEY)

  const response = await fetch(`https://${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  if (!response.ok) {
    throw new Error(`Sign-in could not be completed (${response.status})`)
  }
  return response.json()
}

/** Cognito's logout URL. It ends the Google session too and returns to /login. */
export function cognitoLogoutUrl(): string {
  const { DOMAIN, CLIENT_ID } = config()
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: `${window.location.origin}/login`,
  })
  return `https://${DOMAIN}/logout?${params}`
}
