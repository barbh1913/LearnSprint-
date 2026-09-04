import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HealthCheckPage } from './HealthCheckPage'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HealthCheckPage', () => {
  it('shows ok once the backend health check succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok' }),
      }),
    )

    render(<HealthCheckPage />)

    await waitFor(() =>
      expect(screen.getByText('Backend status: ok')).toBeInTheDocument(),
    )
  })

  it('shows error when the backend health check fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    )

    render(<HealthCheckPage />)

    await waitFor(() =>
      expect(screen.getByText('Backend status: error')).toBeInTheDocument(),
    )
  })
})
