import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleCalendarControls } from './GoogleCalendarControls'

type Handler = (options: RequestInit) => { status?: number; body?: unknown }

function mockApi(routes: Record<string, Handler>) {
  const calls: { path: string; method: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = url.replace(/^.*\/api/, '')
      const method = options.method ?? 'GET'
      calls.push({ path, method })
      const handler = routes[`${method} ${path}`]
      if (!handler) throw new Error(`Unexpected request: ${method} ${path}`)
      const { status = 200, body } = handler(options)
      return { ok: status < 400, status, json: async () => body }
    }),
  )
  return calls
}

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('GoogleCalendarControls', () => {
  it('shows the feature as not available when the server has no Google client', async () => {
    mockApi({
      'GET /integrations/google-calendar/status': () => ({
        body: { configured: false, connected: false, connectedAt: null, lastSyncedAt: null },
      }),
    })

    render(<GoogleCalendarControls courseId="c1" canSync />)

    expect(await screen.findByText('Not available')).toBeInTheDocument()
    expect(screen.getByText(/not set up on this server/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect Google Calendar' })).toBeDisabled()
  })

  it('syncs the chosen course and reports how much landed', async () => {
    let lastSyncedAt: string | null = null
    const calls = mockApi({
      'GET /integrations/google-calendar/status': () => ({
        body: { configured: true, connected: true, connectedAt: '2026-09-16T10:00:00', lastSyncedAt },
      }),
      'POST /integrations/google-calendar/sync?courseId=c1': () => {
        lastSyncedAt = '2026-09-16T12:30:00'
        return {
          body: {
            synced: 7,
            lastSyncedAt,
            courses: [{ courseId: 'c1', courseName: 'Data Structures', synced: 7, skipped: null }],
          },
        }
      },
    })

    render(<GoogleCalendarControls courseId="c1" canSync />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }))

    expect(await screen.findByRole('status')).toHaveTextContent('7 sessions are now in your Google Calendar.')
    expect(await screen.findByText(/Last synced/)).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('syncs every course when the calendar shows all courses, and says what was skipped', async () => {
    const calls = mockApi({
      'GET /integrations/google-calendar/status': () => ({
        body: { configured: true, connected: true, connectedAt: '2026-09-16T10:00:00', lastSyncedAt: null },
      }),
      'POST /integrations/google-calendar/sync': () => ({
        body: {
          synced: 9,
          lastSyncedAt: '2026-09-16T12:30:00',
          courses: [
            { courseId: 'c1', courseName: 'Data Structures', synced: 9, skipped: null },
            { courseId: 'c2', courseName: 'OOP', synced: 0, skipped: "This plan doesn't fit" },
          ],
        },
      }),
    })

    render(<GoogleCalendarControls courseId="" canSync />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('9 sessions are now in your Google Calendar.')
    expect(notice).toHaveTextContent("Skipped OOP (This plan doesn't fit).")
    expect(calls.some((call) => call.method === 'POST' && call.path === '/integrations/google-calendar/sync')).toBe(true)
  })

  it('will not offer to sync a plan that does not fit', async () => {
    mockApi({
      'GET /integrations/google-calendar/status': () => ({
        body: { configured: true, connected: true, connectedAt: '2026-09-16T10:00:00', lastSyncedAt: null },
      }),
    })

    render(<GoogleCalendarControls courseId="c1" canSync={false} />)

    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeDisabled()
  })

  it('shows why the server refused a sync', async () => {
    mockApi({
      'GET /integrations/google-calendar/status': () => ({
        body: { configured: true, connected: true, connectedAt: '2026-09-16T10:00:00', lastSyncedAt: null },
      }),
      'POST /integrations/google-calendar/sync?courseId=c1': () => ({
        status: 502,
        body: { detail: 'Google Calendar access has expired - connect it again' },
      }),
    })

    render(<GoogleCalendarControls courseId="c1" canSync />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('connect it again')
  })

  it('offers to connect, remembers the state nonce, and leaves for Google', async () => {
    mockApi({
      'GET /integrations/google-calendar/status': () => ({
        body: { configured: true, connected: false, connectedAt: null, lastSyncedAt: null },
      }),
      'GET /integrations/google-calendar/authorize': () => ({
        body: { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', state: 'nonce-1' },
      }),
    })
    const goToExternal = vi.fn()

    render(<GoogleCalendarControls courseId="c1" canSync goToExternal={goToExternal} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }))

    await waitFor(() =>
      expect(goToExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'),
    )
    expect(sessionStorage.getItem('learnsprint.google_calendar_state')).toBe('nonce-1')
  })

  it('shows a connected account and can disconnect it', async () => {
    let connected = true
    const calls = mockApi({
      'GET /integrations/google-calendar/status': () => ({
        body: {
          configured: true,
          connected,
          connectedAt: '2026-09-16T10:00:00',
          lastSyncedAt: null,
        },
      }),
      'DELETE /integrations/google-calendar/connection': () => {
        connected = false
        return { status: 204 }
      },
    })

    render(<GoogleCalendarControls courseId="c1" canSync />)

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText(/not synced yet/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(await screen.findByText('Not connected')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
  })
})
