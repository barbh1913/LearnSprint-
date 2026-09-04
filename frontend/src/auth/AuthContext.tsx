// Holds the logged-in user for the whole app. The token itself lives in
// localStorage (see api/client.ts) so a refresh doesn't log you out.

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, clearToken, getToken, setToken } from '../api/client'
import type { User } from '../types'

interface AuthState {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
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

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
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
