import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest isn't running with `globals: true`, so Testing Library's automatic
// cleanup never registers and rendered trees leak between tests.
afterEach(cleanup)
