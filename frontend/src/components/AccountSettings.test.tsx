import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSettings } from './AccountSettings'
import { AuthProvider } from '../auth/AuthContext'

const ME = { id: 'u1', email: 'bar@example.com' }

/** fetch that answers /auth/me with the signed-in user and everything else with `answer`. */
function stubFetch(answer: (url: string, init?: RequestInit) => Promise<Partial<Response>>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).endsWith('/auth/me') && (!init?.method || init.method === 'GET')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ME })
    }
    return answer(String(url), init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderSettings() {
  localStorage.setItem('learnsprint.token', 'token')
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AccountSettings />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('AccountSettings', () => {
  it('changes the password and reports it', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 204 }))
    renderSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Change password' }))
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-secret' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-secret-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Password changed.')
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/change-password'))
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      currentPassword: 'old-secret',
      newPassword: 'new-secret-1',
    })
  })

  it('shows the server reason when the current password is wrong', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'The current password is wrong' }),
    }))
    renderSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Change password' }))
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'nope' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-secret-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The current password is wrong')
  })

  it('only deletes once the word DELETE is typed, then ends the session', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 204 }))
    renderSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    const confirmButton = await screen.findByRole('button', { name: 'Delete everything' })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Type DELETE'), { target: { value: 'delete' } })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Type DELETE'), { target: { value: 'DELETE' } })
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)

    await waitFor(() => expect(localStorage.getItem('learnsprint.token')).toBeNull())
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/auth/me') && init?.method === 'DELETE',
    )
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ confirm: 'DELETE' })
  })
})
