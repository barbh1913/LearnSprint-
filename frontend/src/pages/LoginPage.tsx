import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { Button, ErrorNote, Field, Input } from '../components/ui/primitives'

export function LoginPage() {
  const { user, login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      await (mode === 'login' ? login(email, password) : register(email, password))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex size-11 items-center justify-center rounded-xl bg-primary/10">
            <Zap className="size-5 text-primary" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">LearnSprint</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan your exam prep around what you actually need to review.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@university.ac.il"
              required
              autoComplete="email"
            />
          </Field>

          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </Field>

          {error && <ErrorNote message={error} />}

          <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Please wait' : mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError('')
              }}
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </form>
      </div>
    </div>
  )
}
