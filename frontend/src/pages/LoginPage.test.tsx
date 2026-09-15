import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { AuthProvider } from '../auth/AuthContext'

function renderLogin() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('LoginPage', () => {
  it('starts in sign-in mode', async () => {
    renderLogin()

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('switches to sign-up mode', async () => {
    renderLogin()

    fireEvent.click(await screen.findByRole('button', { name: 'Sign up' }))

    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
  })

  it('shows the error when the credentials are rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Invalid email or password' }),
      }),
    )
    renderLogin()

    fireEvent.change(await screen.findByPlaceholderText(/name@/), {
      target: { value: 'bar@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'wrongpass' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
  })
})
