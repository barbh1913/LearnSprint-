import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { AuthProvider } from '../auth/AuthContext'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <AuthProvider>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

function okResponse() {
  return { ok: true, status: 204, json: async () => ({}) }
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('ForgotPasswordPage', () => {
  it('asks for the code after the email is sent, then resets and returns to sign-in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(await screen.findByPlaceholderText(/name@/), {
      target: { value: 'bar@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))

    fireEvent.change(await screen.findByPlaceholderText('123456'), { target: { value: ' 654321 ' } })
    fireEvent.change(screen.getByPlaceholderText(/8 characters/), { target: { value: 'n3wpassword' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument())
    const [forgotUrl, forgotInit] = fetchMock.mock.calls[0]
    const [resetUrl, resetInit] = fetchMock.mock.calls[1]
    expect(String(forgotUrl)).toContain('/auth/forgot-password')
    expect(JSON.parse(forgotInit.body)).toEqual({ email: 'bar@example.com' })
    expect(String(resetUrl)).toContain('/auth/reset-password')
    expect(JSON.parse(resetInit.body)).toEqual({
      email: 'bar@example.com',
      code: '654321',
      newPassword: 'n3wpassword',
    })
  })

  it('shows the server message when the code is wrong', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(okResponse())
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ detail: 'That code is wrong or has expired' }),
        }),
    )
    renderPage()

    fireEvent.change(await screen.findByPlaceholderText(/name@/), {
      target: { value: 'bar@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    fireEvent.change(await screen.findByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.change(screen.getByPlaceholderText(/8 characters/), { target: { value: 'n3wpassword' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired')
  })
})
