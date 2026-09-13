import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarPage } from './CalendarPage'

const course = {
  id: 'c1',
  name: 'Data Structures',
  year: 2,
  semester: 'A',
  credits: 4,
  examDate: '2026-10-01',
  examType: 'closed',
  role: 'owner',
}

const schedule = {
  feasible: true,
  isEmergencyMode: false,
  totalAvailableMinutes: 600,
  totalNeededMinutes: 240,
  blocks: [
    {
      start: '2026-09-14T18:00:00',
      end: '2026-09-14T19:00:00',
      durationMinutes: 60,
      blockType: 'action',
      topicId: 't1',
      topicName: 'Trees',
      actionType: 'read',
      actionId: 'a1',
      label: 'Read: Trees',
    },
  ],
}

const board = {
  columns: {},
  cards: [
    {
      topicId: 't1',
      courseId: 'c1',
      courseName: 'Data Structures',
      name: 'Trees',
      isPriority: false,
      masteryLevel: null,
      status: 'todo',
      needsMasteryRating: false,
      actions: [
        { id: 'a1', type: 'read', durationMinutes: 60, isDone: false },
        { id: 'a2', type: 'summarize', durationMinutes: 30, isDone: false },
        { id: 'a3', type: 'quiz', durationMinutes: 30, isDone: false },
      ],
      actionsDone: 0,
      totalMinutes: 120,
    },
  ],
  totalTopics: 1,
  doneTopics: 0,
}

function mockApi(responses: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace(/^.*\/api/, '')
      // Longest prefix wins, so "/courses/c1/schedule" isn't swallowed by "/courses".
      const match = Object.keys(responses)
        .sort((a, b) => b.length - a.length)
        .find((key) => path.startsWith(key))
      if (!match) throw new Error(`Unexpected request: ${url}`)
      return { ok: true, status: 200, json: async () => responses[match] }
    }),
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useFakeTimers({ now: new Date(2026, 8, 16, 12), toFake: ['Date'] })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>,
  )
}

describe('CalendarPage', () => {
  it('opens on the week of the plan with the summary metrics on top', async () => {
    mockApi({ '/courses': [course], '/courses/c1/schedule': schedule, '/board': board })

    renderPage()

    expect(await screen.findByRole('button', { name: /Read: Trees/ })).toBeInTheDocument()
    expect(screen.getByText('Study time planned')).toBeInTheDocument()
    expect(screen.getByText('4h')).toBeInTheDocument()
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download .ics' })).toBeInTheDocument()
  })

  it('moves between weeks', async () => {
    mockApi({ '/courses': [course], '/courses/c1/schedule': schedule, '/board': board })
    renderPage()
    await screen.findByRole('button', { name: /Read: Trees/ })

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))

    expect(screen.queryByRole('button', { name: /Read: Trees/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Sep 20/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('button', { name: /Read: Trees/ })).toBeInTheDocument()
  })

  it('opens the topic behind an event with that action highlighted', async () => {
    mockApi({ '/courses': [course], '/courses/c1/schedule': schedule, '/board': board })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /Read: Trees/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Topic name')).toHaveValue('Trees')
    const readRow = screen.getByLabelText('Read done').closest('div')
    expect(readRow).toHaveClass('border-primary')
    expect(screen.getByLabelText('Quiz done').closest('div')).not.toHaveClass('border-primary')
  })

  it('explains an infeasible plan instead of drawing a grid', async () => {
    mockApi({
      '/courses': [course],
      '/courses/c1/schedule': {
        feasible: false,
        reason: 'Not enough free time before the exam.',
        shortfallMinutes: 90,
        totalAvailableMinutes: 30,
        totalNeededMinutes: 120,
        blocks: [],
      },
      '/board': board,
    })

    renderPage()

    await waitFor(() => expect(screen.getByText("This plan doesn't fit")).toBeInTheDocument())
    expect(screen.getByText(/1h 30m more free time/)).toBeInTheDocument()
    expect(screen.queryByText('Sun')).not.toBeInTheDocument()
  })
})
