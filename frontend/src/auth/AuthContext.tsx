// Holds the logged-in user for the whole app. The token itself lives in
// localStorage (see api/client.ts) so a refresh doesn't log you out.

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, clearToken, getToken, setToken } from '../api/client'
import { cognitoConfigured, cognitoLogoutUrl } from './cognito'
import type { User } from '../types'

// Remembers whether the current session came from Google/Cognito, because
// logging out of one of those has to end the Cognito session as well.
const AUTH_SOURCE_KEY = 'learnsprint.auth_source'

interface AuthState {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  /** Adopt a token issued elsewhere - the Cognito id_token after Google sign-in. */
  loginWithToken: (token: string) => Promise<void>
  logout: () => void
  /** Delete the account on the server, then end the session the same way logout does. */
  deleteAccount: (confirm: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // On mount, trade any stored token for the user it belongs to. A stale or
  // tampered token just means we start logged out.
  useEffect(() => {
    if (!getToken()) {
      setIsLoading(false)
      return
    }

    api
      .me()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { access_token } = await api.login(email, password)
    setToken(access_token)
    setUser(await api.me())
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const { access_token } = await api.register(email, password)
    setToken(access_token)
    setUser(await api.me())
  }, [])

  const loginWithToken = useCallback(async (token: string) => {
    setToken(token)
    localStorage.setItem(AUTH_SOURCE_KEY, 'cognito')
    setUser(await api.me())
  }, [])

  const logout = useCallback(() => {
    const source = localStorage.getItem(AUTH_SOURCE_KEY)
    clearToken()
    localStorage.removeItem(AUTH_SOURCE_KEY)
    setUser(null)

    // A Google session also lives at Cognito. Without ending it there, the next
    // "Continue with Google" would silently sign the same person straight back in.
    if (source === 'cognito' && cognitoConfigured) {
      window.location.href = cognitoLogoutUrl()
    }
  }, [])

  const deleteAccount = useCallback(
    async (confirm: string) => {
      await api.deleteAccount(confirm)
      logout()
    },
    [logout],
  )

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, register, loginWithToken, logout, deleteAccount }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }
  return context
}
