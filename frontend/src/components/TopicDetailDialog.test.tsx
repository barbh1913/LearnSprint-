import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCard } from '../types'
import { TopicDetailDialog } from './TopicDetailDialog'

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    topicId: 't1',
    courseId: 'c1',
    courseName: 'Data Structures',
    name: 'Heaps',
    description: null,
    priority: 'medium',
    isPriority: false,
    masteryLevel: null,
    status: 'todo',
    needsMasteryRating: false,
    actions: [
      { id: 'a1', type: 'read', title: 'Read', order: 0, durationMinutes: 60, isDone: false },
      { id: 'a2', type: 'summarize', title: 'Summarize', order: 1, durationMinutes: 45, isDone: false },
      { id: 'a3', type: 'quiz', title: 'Quiz', order: 2, durationMinutes: 30, isDone: false },
    ],
    actionsDone: 0,
    totalMinutes: 135,
    ...overrides,
  }
}

interface Call {
  method: string
  path: string
  body: unknown
}

function mockApi(materials: unknown[] = []) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = url.replace(/^.*\/api/, '')
      const method = options.method ?? 'GET'
      const body =
        typeof options.body === 'string' ? JSON.parse(options.body) : options.body instanceof FormData ? 'form-data' : null
      calls.push({ method, path, body })
      if (path.endsWith('/download')) {
        return { ok: true, status: 200, json: async () => ({ url: 'https://bucket/file?sig=1', expiresInSeconds: 300 }) }
      }
      if (path.endsWith('/materials') && method === 'GET') {
        return { ok: true, status: 200, json: async () => materials }
      }
      if (path.endsWith('/materials/upload-url') && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ uploadUrl: 'https://fake-bucket.test/key', key: 'fake-key', expiresInSeconds: 300 }),
        }
      }
      if (method === 'DELETE') return { ok: true, status: 204, json: async () => undefined }
      return { ok: true, status: 200, json: async () => ({}) }
    }),
  )
  return calls
}

function renderDialog(props: Partial<React.ComponentProps<typeof TopicDetailDialog>> = {}) {
  const onChanged = vi.fn()
  render(
    <MemoryRouter>
      <TopicDetailDialog card={card()} onClose={vi.fn()} onChanged={onChanged} {...props} />
    </MemoryRouter>,
  )
  return onChanged
}

function lastCall(calls: Call[], method: string): Call | undefined {
  return [...calls].reverse().find((call) => call.method === method)
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('TopicDetailDialog', () => {
  it('shows the task fields: status, priority, estimate, assignee, subtasks in order', async () => {
    mockApi()
    renderDialog()

    expect(screen.getByLabelText('Status')).toHaveValue('todo')
    expect(screen.getByLabelText('Priority')).toHaveValue('medium')
    expect(screen.getByLabelText('Estimated minutes')).toHaveValue(135)
    expect(screen.getByText('Me')).toBeInTheDocument()
    expect(screen.getAllByLabelText(/ title$/).map((input) => (input as HTMLInputElement).value)).toEqual([
      'Read',
      'Summarize',
      'Quiz',
    ])
    expect(await screen.findByText(/No files yet/)).toBeInTheDocument()
  })

  it('changes status through the same override the board drag uses', async () => {
    const calls = mockApi()
    const onChanged = renderDialog()

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in_progress' } })

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(lastCall(calls, 'PATCH')).toMatchObject({ path: '/topics/t1/progress?courseId=c1', body: { status: 'in_progress' } })
  })

  it('sets the priority level and the description', async () => {
    const calls = mockApi()
    const onChanged = renderDialog()

    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(lastCall(calls, 'PATCH')).toMatchObject({ path: '/courses/c1/topics/t1', body: { priority: 'high' } })

    const description = screen.getByLabelText('Description')
    fireEvent.change(description, { target: { value: 'Binary heaps and heapsort' } })
    fireEvent.blur(description)
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    expect(lastCall(calls, 'PATCH')).toMatchObject({ body: { description: 'Binary heaps and heapsort' } })
  })

  it('sends a topic-level estimate for the server to split across subtasks', async () => {
    const calls = mockApi()
    const onChanged = renderDialog()

    const estimate = screen.getByLabelText('Estimated minutes')
    fireEvent.change(estimate, { target: { value: '270' } })
    fireEvent.blur(estimate)

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(lastCall(calls, 'PATCH')).toMatchObject({ path: '/courses/c1/topics/t1', body: { estimatedMinutes: 270 } })
  })

  it('adds, renames and deletes subtasks, keeping at least one', async () => {
    const calls = mockApi()
    const onChanged = renderDialog()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.change(screen.getByLabelText('New subtask'), { target: { value: 'Solve exercise sheet 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(lastCall(calls, 'POST')).toMatchObject({
      path: '/courses/c1/topics/t1/actions',
      body: { title: 'Solve exercise sheet 3', durationMinutes: 30 },
    })

    const readTitle = screen.getByLabelText('Read title')
    fireEvent.change(readTitle, { target: { value: 'Read chapter 4' } })
    fireEvent.blur(readTitle)
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    expect(lastCall(calls, 'PATCH')).toMatchObject({ path: '/courses/c1/topics/t1/actions/a1', body: { title: 'Read chapter 4' } })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Quiz' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(3))
    expect(window.confirm).toHaveBeenCalledWith('Delete "Quiz"? This also removes everyone\'s progress on it.')
    expect(lastCall(calls, 'DELETE')).toMatchObject({ path: '/courses/c1/topics/t1/actions/a3' })
  })

  it('will not delete the last subtask', () => {
    mockApi()
    renderDialog({ card: card({ actions: [card().actions[0]], totalMinutes: 60 }) })

    expect(screen.getByRole('button', { name: 'Delete Read' })).toBeDisabled()
  })

  it('highlights the subtasks a calendar event pointed at', () => {
    mockApi()
    renderDialog({ highlightActionIds: ['a2'] })

    expect(screen.getByLabelText('Summarize done').closest('div')).toHaveClass('border-primary')
    expect(screen.getByLabelText('Read done').closest('div')).not.toHaveClass('border-primary')
  })

  it('lists attachments, downloads through a fresh link, and deletes', async () => {
    const calls = mockApi([
      { id: 'm1', topicId: 't1', fileName: 'lecture5.pdf', fileType: 'pdf', sizeBytes: 2048, uploadedAt: '2026-09-16T10:00:00' },
    ])
    const openExternal = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderDialog({ openExternal })

    expect(await screen.findByText('lecture5.pdf')).toBeInTheDocument()
    expect(screen.getByText('2 KB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Download lecture5.pdf' }))
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://bucket/file?sig=1'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete lecture5.pdf' }))
    await waitFor(() =>
      expect(lastCall(calls, 'DELETE')).toMatchObject({ path: '/courses/c1/topics/t1/materials/m1' }),
    )
  })

  it('uploads attachments straight to S3, then attaches the ref to the topic', async () => {
    const calls = mockApi()
    renderDialog()
    await screen.findByText(/No files yet/)

    const file = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [file] } })

    await waitFor(() =>
      expect(lastCall(calls, 'POST')).toMatchObject({
        path: '/courses/c1/topics/t1/materials',
        body: { files: [{ key: 'fake-key', fileName: 'notes.pdf' }] },
      }),
    )
  })
})
