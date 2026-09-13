import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleCalendarCallbackPage } from './GoogleCalendarCallbackPage'

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/calendar/google/callback" element={<GoogleCalendarCallbackPage />} />
        <Route path="/calendar" element={<p>Calendar home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockConnect(status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () =>
      status < 400
        ? { configured: true, connected: true, connectedAt: 'now', lastSyncedAt: null }
        : { detail: 'Google did not accept the sign-in code' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('GoogleCalendarCallbackPage', () => {
  it('hands the code to the backend and returns to the calendar', async () => {
    sessionStorage.setItem('learnsprint.google_calendar_state', 'nonce-1')
    const fetchMock = mockConnect()

    renderAt('/calendar/google/callback?code=abc&state=nonce-1')

    expect(await screen.findByText('Calendar home')).toBeInTheDocument()
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ code: 'abc' })
    expect(sessionStorage.getItem('learnsprint.google_calendar_state')).toBeNull()
  })

  it('refuses a code whose state did not originate here', async () => {
    sessionStorage.setItem('learnsprint.google_calendar_state', 'nonce-1')
    const fetchMock = mockConnect()

    renderAt('/calendar/google/callback?code=abc&state=someone-elses')

    expect(await screen.findByRole('alert')).toHaveTextContent("didn't start here")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explains a denied consent without calling the backend', async () => {
    const fetchMock = mockConnect()

    renderAt('/calendar/google/callback?error=access_denied')

    expect(await screen.findByRole('alert')).toHaveTextContent('not granted')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the backend’s reason when Google rejects the code', async () => {
    sessionStorage.setItem('learnsprint.google_calendar_state', 'nonce-1')
    mockConnect(502)

    renderAt('/calendar/google/callback?code=abc&state=nonce-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('did not accept')
    expect(screen.getByRole('button', { name: 'Back to the calendar' })).toBeInTheDocument()
  })
})
