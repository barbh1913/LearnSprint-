import { useEffect, useState } from 'react'
import { getHealth } from '../api/client'

export function HealthCheckPage() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    getHealth()
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <main>
      <h1>Study Planner</h1>
      <p>Backend status: {status}</p>
    </main>
  )
}
