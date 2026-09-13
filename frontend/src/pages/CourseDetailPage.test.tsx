import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseDetailPage } from './CourseDetailPage'

const course = {
  id: 'c1',
  name: 'Data Structures',
  year: 2,
  semester: 'A',
  credits: 5,
  examDate: null,
  examType: 'closed',
  finalGrade: null,
  role: 'owner',
}

function topicCard() {
  return {
    topicId: 't1',
    courseId: 'c1',
    courseName: 'Data Structures',
    name: 'Heaps',
    isPriority: false,
    masteryLevel: null,
    status: 'backlog',
    needsMasteryRating: false,
    actions: [{ id: 'a1', type: 'read', durationMinutes: 60, isDone: false }],
    actionsDone: 0,
    totalMinutes: 60,
  }
}

function mockApi({ onPatch, onDelete }: { onPatch?: () => void; onDelete?: () => void } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      if (url.includes('/members')) {
        return { ok: true, status: 200, json: async () => [] }
      }
      if (options.method === 'DELETE') {
        onDelete?.()
        return { ok: true, status: 204, json: async () => undefined }
      }
      if (options.method === 'PATCH') {
        onPatch?.()
        if (options.body && String(options.body).includes('"fail"')) {
          return {
            ok: false,
            status: 422,
            json: async () => ({ detail: 'That topic could not be updated' }),
          }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }
      if (url.includes('/board')) {
        return { ok: true, status: 200, json: async () => ({ cards: [topicCard()] }) }
      }
      if (url.endsWith('/courses/c1')) {
        return { ok: true, status: 200, json: async () => course }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }),
  )
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/courses/c1']}>
      <Routes>
        <Route path="/courses/:courseId" element={<CourseDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CourseDetailPage', () => {
  it('shows the course and its topics', async () => {
    mockApi()
    renderPage()

    expect(await screen.findByText('Data Structures')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Heaps')).toBeInTheDocument()
  })

  it('asks for confirmation before deleting a topic, and skips the call when declined', async () => {
    let deleted = false
    mockApi({ onDelete: () => (deleted = true) })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()

    fireEvent.click(await screen.findByLabelText('Delete Heaps'))

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete "Heaps"? This also removes everyone\'s progress on it.',
    )
    expect(deleted).toBe(false)
  })

  it('deletes the topic once the confirmation is accepted', async () => {
    let deleted = false
    mockApi({ onDelete: () => (deleted = true) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    fireEvent.click(await screen.findByLabelText('Delete Heaps'))

    await waitFor(() => expect(deleted).toBe(true))
  })

  it('shows an error instead of failing silently when a rename is rejected', async () => {
    mockApi()
    renderPage()

    const input = await screen.findByDisplayValue('Heaps')
    fireEvent.change(input, { target: { value: 'fail' } })
    fireEvent.blur(input)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That topic could not be updated',
    )
  })
})
