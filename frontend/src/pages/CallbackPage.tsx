import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { exchangeCodeForTokens } from '../auth/cognito'
import { Button, ErrorNote, Spinner } from '../components/ui/primitives'

/** Where Cognito sends the browser back after Google sign-in.
 *
 * The path must match the pool's allowed callback URL exactly. The code in the
 * query string is single-use, so this runs once and never retries.
 */
export function CallbackPage() {
  const navigate = useNavigate()
  const { loginWithToken } = useAuth()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    // The code in the URL is single-use, so this must run exactly once. Two
    // things would otherwise run it again: StrictMode's simulated remount in
    // development, and react-router handing out a new `navigate` whenever the
    // path changes. A second exchange always fails with 400, and that error
    // would overwrite the first one's success. The ref survives both.
    if (started.current) return
    started.current = true

    const params = new URLSearchParams(window.location.search)
    const denied = params.get('error')
    const code = params.get('code')

    if (denied) {
      setError(params.get('error_description') ?? 'Sign-in was cancelled.')
      return
    }
    if (!code) {
      navigate('/login', { replace: true })
      return
    }

    exchangeCodeForTokens(code)
      .then((tokens) => loginWithToken(tokens.id_token))
      .then(() => navigate('/dashboard', { replace: true }))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Sign-in could not be completed.'),
      )
  }, [navigate, loginWithToken])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center">
        {error ? (
          <>
            <ErrorNote message={error} />
            <Button className="mt-4" onClick={() => navigate('/login')}>
              Back to sign in
            </Button>
          </>
        ) : (
          <Spinner label="Completing sign-in" />
        )}
      </div>
    </div>
  )
}
