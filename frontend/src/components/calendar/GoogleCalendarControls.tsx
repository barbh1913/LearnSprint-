import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, CalendarX } from 'lucide-react'
import { api } from '../../api/client'
import type { GoogleCalendarStatus } from '../../types'
import { Badge, Button, Card, ErrorNote } from '../ui/primitives'
import { rememberState } from './googleCalendarState'

/**
 * Connect / disconnect the student's Google account (FR6.2). Renders nothing
 * when the server has no Google client configured, so a deployment without
 * the feature just doesn't show it.
 */
export function GoogleCalendarControls({
  courseId,
  canSync,
  goToExternal = (url) => window.location.assign(url),
}: {
  /** The course "Sync now" pushes, or '' for every course with a plan - the Calendar's filter. */
  courseId: string
  /** False while the plan is infeasible or empty - the button explains instead of failing. */
  canSync: boolean
  /** Overridable so tests can catch the redirect instead of leaving jsdom. */
  goToExternal?: (url: string) => void
}) {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const loadStatus = useCallback(() => {
    api
      .getGoogleCalendarStatus()
      .then(setStatus)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not check Google Calendar'))
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  async function handleConnect() {
    setIsBusy(true)
    setError('')
    try {
      const { authorizeUrl, state } = await api.getGoogleCalendarAuthorizeUrl()
      rememberState(state)
      goToExternal(authorizeUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start connecting')
      setIsBusy(false)
    }
  }

  async function handleDisconnect() {
    setIsBusy(true)
    setError('')
    setNotice('')
    try {
      await api.disconnectGoogleCalendar()
      loadStatus()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not disconnect')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleSync() {
    setIsBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api.syncGoogleCalendar(courseId || undefined)
      const skipped = result.courses.filter((course) => course.skipped)
      setNotice(
        [
          result.synced === 1
            ? '1 session is now in your Google Calendar.'
            : `${result.synced} sessions are now in your Google Calendar.`,
          skipped.length > 0 &&
            `Skipped ${skipped.map((course) => `${course.courseName} (${course.skipped})`).join('; ')}.`,
        ]
          .filter(Boolean)
          .join(' '),
      )
      loadStatus()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sync')
    } finally {
      setIsBusy(false)
    }
  }

  if (!status?.configured) return null

  const Icon = status.connected ? CalendarCheck : CalendarX

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon
            className={status.connected ? 'size-5 text-emerald-600' : 'size-5 text-muted-foreground'}
            aria-hidden
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Google Calendar</span>
              <Badge tone={status.connected ? 'success' : 'neutral'}>
                {status.connected ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {status.connected
                ? status.lastSyncedAt
                  ? `Last synced ${formatDate(status.lastSyncedAt)}`
                  : `Connected ${formatDate(status.connectedAt)} - not synced yet`
                : 'Mirror this plan into a "LearnSprint" calendar in your Google account.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status.connected ? (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={handleSync}
                disabled={isBusy || !canSync}
                title={canSync ? undefined : 'There is no plan to sync yet'}
              >
                {isBusy ? 'Syncing' : 'Sync now'}
              </Button>
              <Button size="sm" variant="danger" onClick={handleDisconnect} disabled={isBusy}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={handleConnect} disabled={isBusy}>
              {isBusy ? 'Opening Google' : 'Connect Google Calendar'}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}
    </Card>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
