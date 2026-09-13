import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { takeState } from '../components/calendar/googleCalendarState'
import { Button, ErrorNote, Spinner } from '../components/ui/primitives'

/** Where Google sends the browser back after the Calendar consent screen (FR6.2).
 *
 * Sits inside the signed-in app: the backend needs our own token to know whose
 * account to attach the Google credential to. The code is single-use, so this
 * runs once - same guard as the Cognito callback.
 */
export function GoogleCalendarCallbackPage() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const params = new URLSearchParams(search)
    const code = params.get('code')
    const denied = params.get('error')

    if (denied) {
      setError('Google access was not granted, so nothing was connected.')
      return
    }
    if (!code) {
      navigate('/calendar', { replace: true })
      return
    }
    if (params.get('state') !== takeState()) {
      setError("This connection attempt didn't start here. Go back and try connecting again.")
      return
    }

    api
      .connectGoogleCalendar(code)
      .then(() => navigate('/calendar', { replace: true }))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Google Calendar could not be connected.'),
      )
  }, [search, navigate])

  return (
    <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-6 text-center">
      {error ? (
        <>
          <ErrorNote message={error} />
          <Button className="mt-4" onClick={() => navigate('/calendar')}>
            Back to the calendar
          </Button>
        </>
      ) : (
        <Spinner label="Connecting Google Calendar" />
      )}
    </div>
  )
}
