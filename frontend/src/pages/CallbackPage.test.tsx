import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { CallbackPage } from './CallbackPage'

// The Cognito module is replaced wholesale: what's under test is the page's
// behaviour around the exchange, not the exchange itself.
const { exchangeCodeForTokens } = vi.hoisted(() => ({ exchangeCodeForTokens: vi.fn() }))
vi.mock('../auth/cognito', () => ({
  cognitoConfigured: true,
  exchangeCodeForTokens,
  cognitoLogoutUrl: () => 'https://example.com/logout',
}))

// Rendered under a real StrictMode on purpose: in development it mounts every
// component twice, which is exactly the condition that once sent a single-use
// code to Cognito twice and turned a successful sign-in into a 400.
function renderCallback() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/callback']}>
        <AuthProvider>
          <Routes>
            <Route path="/callback" element={<CallbackPage />} />
            <Route path="/dashboard" element={<p>Dashboard</p>} />
            <Route path="/login" element={<p>Login</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  exchangeCodeForTokens.mockReset()
  vi.restoreAllMocks()
})

describe('CallbackPage', () => {
  it('exchanges the code exactly once, even though StrictMode mounts twice', async () => {
    window.history.pushState({}, '', '/callback?code=abc123')
    exchangeCodeForTokens.mockResolvedValue({
      id_token: 'id.token',
      access_token: 'access.token',
      expires_in: 3600,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'u1', email: 'bar@gmail.com' }),
      }),
    )

    renderCallback()

    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(1)
    expect(exchangeCodeForTokens).toHaveBeenCalledWith('abc123')
    expect(localStorage.getItem('learnsprint.token')).toBe('id.token')
  })

  it('shows the failure and a way back when Cognito rejects the code', async () => {
    window.history.pushState({}, '', '/callback?code=already-used')
    exchangeCodeForTokens.mockRejectedValue(new Error('Sign-in could not be completed (400)'))

    renderCallback()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in could not be completed (400)',
    )
    expect(screen.getByRole('button', { name: 'Back to sign in' })).toBeInTheDocument()
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(1)
  })

  it('explains when the user cancelled at Google, without calling Cognito', async () => {
    window.history.pushState(
      {},
      '',
      '/callback?error=access_denied&error_description=The+user+cancelled+sign-in',
    )

    renderCallback()

    expect(await screen.findByRole('alert')).toHaveTextContent('The user cancelled sign-in')
    expect(exchangeCodeForTokens).not.toHaveBeenCalled()
  })

  it('sends a visitor with no code back to the login page', async () => {
    window.history.pushState({}, '', '/callback')

    renderCallback()

    expect(await screen.findByText('Login')).toBeInTheDocument()
    expect(exchangeCodeForTokens).not.toHaveBeenCalled()
  })
})
