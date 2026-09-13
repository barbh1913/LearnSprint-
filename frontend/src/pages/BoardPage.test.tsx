import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardPage } from './BoardPage'

const sprint = {
  startsAt: '2026-09-06T00:00:00Z',
  endsAt: '2026-09-13T00:00:00Z',
  daysRemaining: 5,
  capacityMinutes: 600,
  committedMinutes: 0,
  completedMinutes: 0,
  remainingCapacityMinutes: 600,
  topicCount: 0,
  backlogCount: 1,
  status: 'healthy' as const,
}

function baseCard(status: string) {
  return {
    topicId: 't1',
    courseId: 'c1',
    courseName: 'Data Structures',
    name: 'Heaps',
    description: null,
    priority: 'medium',
    isPriority: false,
    masteryLevel: null,
    status,
    needsMasteryRating: false,
    actions: [
      { id: 'a1', type: 'read', title: 'Read', order: 0, durationMinutes: 60, isDone: false },
      { id: 'a2', type: 'summarize', title: 'Summarize', order: 1, durationMinutes: 45, isDone: false },
      { id: 'a3', type: 'quiz', title: 'Quiz', order: 2, durationMinutes: 30, isDone: false },
    ],
    actionsDone: 0,
    totalMinutes: 135,
  }
}

/** Mocks the three board-load endpoints, tracking the card's status server-side
 * so a drag's PATCH is reflected the next time the board is (re)loaded - the
 * same round trip BoardPage does after every drop. */
function mockBoardApi() {
  let status = 'backlog'
  const patchCalls: Array<{ url: string; body: unknown }> = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      if (url.includes('/board')) {
        const card = baseCard(status)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            columns: {},
            cards: [card],
            totalTopics: 1,
            doneTopics: 0,
          }),
        }
      }
      if (url.includes('/materials') || url.includes('/courses')) {
        return { ok: true, status: 200, json: async () => [] }
      }
      if (url.includes('/sprint')) {
        return { ok: true, status: 200, json: async () => sprint }
      }
      if (url.includes('/topics/') && options.method === 'PATCH') {
        const body = JSON.parse(String(options.body))
        patchCalls.push({ url, body })
        if (body.status) status = body.status
        return {
          ok: true,
          status: 200,
          json: async () => ({ topicId: 't1', status, masteryLevel: null }),
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }),
  )

  return patchCalls
}

function renderBoard() {
  return render(
    <MemoryRouter>
      <BoardPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('BoardPage', () => {
  it('shows the card in its column', async () => {
    mockBoardApi()
    renderBoard()

    const backlogColumn = await screen.findByTestId('column-backlog')
    expect(within(backlogColumn).getByText('Heaps')).toBeInTheDocument()
  })

  it('opens the topic detail view when a card is clicked', async () => {
    mockBoardApi()
    renderBoard()

    fireEvent.click(await screen.findByText('Heaps'))

    expect(await screen.findByLabelText('Topic name')).toHaveValue('Heaps')
    expect(screen.getByLabelText('Read minutes')).toHaveValue(60)
  })

  it('opens from the keyboard, and not from a drag', async () => {
    mockBoardApi()
    renderBoard()
    const card = await screen.findByRole('button', { name: 'Open Heaps' })

    fireEvent.dragStart(card)
    fireEvent.click(card)
    expect(screen.queryByLabelText('Topic name')).not.toBeInTheDocument()

    fireEvent.keyDown(card, { key: 'Enter' })
    expect(await screen.findByLabelText('Topic name')).toHaveValue('Heaps')
  })

  it('dragging a card to In progress moves it there and persists', async () => {
    // Regression coverage for the board's manual-override drag (FR4.3): a
    // card dragged into a column other than Backlog/To do used to bounce
    // straight back to Backlog on the next board read.
    const patchCalls = mockBoardApi()
    renderBoard()

    const card = (await screen.findByText('Heaps')).closest('article')
    const inProgressColumn = screen.getByTestId('column-in_progress')
    expect(card).not.toBeNull()

    fireEvent.dragStart(card as HTMLElement)
    fireEvent.dragOver(inProgressColumn)
    fireEvent.drop(inProgressColumn)

    expect(await within(inProgressColumn).findByText('Heaps')).toBeInTheDocument()
    expect(within(screen.getByTestId('column-backlog')).queryByText('Heaps')).not.toBeInTheDocument()
    expect(patchCalls).toEqual([
      { url: expect.stringContaining('/topics/t1/progress'), body: { status: 'in_progress' } },
    ])
  })
})
