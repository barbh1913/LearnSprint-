import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, ErrorNote, Field, Input } from '../components/ui/primitives'

/** Two steps on one page: ask for the emailed code, then set the new password (ADR 0014). */
export function ForgotPasswordPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<'request' | 'reset'>('request')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  async function handleRequest(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await api.forgotPassword(email)
      setStep('reset')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await api.resetPassword(email, code.trim(), newPassword)
      navigate('/login', { replace: true, state: { notice: 'Password changed. Sign in with the new one.' } })
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
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === 'request'
              ? "We'll email you a code to set a new one."
              : `If ${email} has an account, a code is on its way.`}
          </p>
        </div>

        {step === 'request' ? (
          <form onSubmit={handleRequest} className="space-y-4 rounded-xl border border-border bg-card p-6">
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

            {error && <ErrorNote message={error} />}

            <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Please wait' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-4 rounded-xl border border-border bg-card p-6">
            <Field label="Code from the email">
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </Field>

            <Field label="New password">
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </Field>

            {error && <ErrorNote message={error} />}

            <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Please wait' : 'Set new password'}
            </Button>

            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:underline"
              onClick={() => {
                setStep('request')
                setError('')
              }}
            >
              Didn't get a code? Send it again
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
