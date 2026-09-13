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
  it('stays out of the way when the server has no Google client', async () => {
    mockApi({
      'GET /integrations/google-calendar/status': () => ({
        body: { configured: false, connected: false, connectedAt: null, lastSyncedAt: null },
      }),
    })

    const { container } = render(<GoogleCalendarControls />)

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
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

    render(<GoogleCalendarControls goToExternal={goToExternal} />)

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

    render(<GoogleCalendarControls />)

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText(/not synced yet/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(await screen.findByText('Not connected')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
  })
})
