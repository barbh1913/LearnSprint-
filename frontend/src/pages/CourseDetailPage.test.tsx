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
    description: null,
    priority: 'medium',
    isPriority: false,
    masteryLevel: null,
    status: 'backlog',
    needsMasteryRating: false,
    actions: [{ id: 'a1', type: 'read', title: 'Read', order: 0, durationMinutes: 60, isDone: false }],
    actionsDone: 0,
    totalMinutes: 60,
  }
}

const materialAnalysis = {
  materialId: 'm1',
  fileName: 'lecture5.pdf',
  analysedBy: 'heuristic',
  note: null,
  content: { title: 'Heaps', summary: null, keyPoints: ['Heapify'], topics: ['Heaps'], estimatedMinutes: null, language: 'en' },
  recommendation: {
    decision: 'attach_existing',
    topicId: 't1',
    topicName: 'Heaps',
    confidence: 0.9,
    reason: "The material names 'Heaps' outright",
    suggestedTitle: 'Heaps',
    alternatives: [],
  },
}

function mockApi({
  onPatch,
  onDelete,
  cards = [topicCard()],
}: { onPatch?: () => void; onDelete?: (url: string) => void; cards?: ReturnType<typeof topicCard>[] } = {}) {
  const posts: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      if (url.includes('/members')) {
        return { ok: true, status: 200, json: async () => [] }
      }
      if (url.includes('/materials/upload-url')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ uploadUrl: 'https://fake-bucket.test/key', key: 'fake-key', expiresInSeconds: 300 }),
        }
      }
      if (url.includes('fake-bucket.test')) {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      if (url.includes('/materials/analyze')) {
        posts.push(url)
        return { ok: true, status: 201, json: async () => materialAnalysis }
      }
      if (url.includes('/materials/m1/confirm')) {
        posts.push(url)
        return {
          ok: true,
          status: 200,
          json: async () => ({ materialId: 'm1', topicId: 't1', topicName: 'Heaps', created: false, alreadyConfirmed: false }),
        }
      }
      if (options.method === 'DELETE') {
        onDelete?.(url)
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
        return { ok: true, status: 200, json: async () => ({ cards }) }
      }
      if (url.endsWith('/courses/c1')) {
        return { ok: true, status: 200, json: async () => course }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }),
  )
  return posts
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

    expect(screen.getByRole('dialog', { name: 'Delete topic?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(window.confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleted).toBe(false)
  })

  it('deletes the topic once the confirmation is accepted', async () => {
    let deleted = false
    mockApi({ onDelete: () => (deleted = true) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    fireEvent.click(await screen.findByLabelText('Delete Heaps'))

    expect(deleted).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('deletes every selected topic after one confirmation', async () => {
    const deleted: string[] = []
    mockApi({
      onDelete: (url) => deleted.push(url),
      cards: [topicCard(), { ...topicCard(), topicId: 't2', name: 'Tries' }, { ...topicCard(), topicId: 't3', name: 'Graphs' }],
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    fireEvent.click(await screen.findByLabelText('Select Heaps'))
    fireEvent.click(screen.getByLabelText('Select Graphs'))
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }))

    expect(screen.getByRole('dialog', { name: 'Delete topics?' })).toBeInTheDocument()
    expect(deleted).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleted).toHaveLength(2))
    expect(deleted.map((url) => url.split('/').pop())).toEqual(['t1', 't3'])
  })

  it('select all covers every topic and can be cleared', async () => {
    mockApi({ cards: [topicCard(), { ...topicCard(), topicId: 't2', name: 'Tries' }] })
    renderPage()

    fireEvent.click(await screen.findByLabelText('Select all topics'))
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument()
    expect(screen.getByLabelText('Select Tries')).toBeChecked()

    fireEvent.click(screen.getByLabelText('Select all topics'))
    expect(screen.queryByRole('button', { name: /Delete selected/ })).not.toBeInTheDocument()
  })

  it('analyses one file, shows the decision dialog, and files it where the student chooses', async () => {
    const posts = mockApi()
    renderPage()
    await screen.findByDisplayValue('Heaps')

    const file = new File(['%PDF'], 'lecture5.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Analyse one file'), { target: { files: [file] } })

    expect(await screen.findByText('Material analysed')).toBeInTheDocument()
    expect(posts.some((url) => url.endsWith('/courses/c1/materials/analyze'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Attach to Heaps' }))

    expect(await screen.findByText('Filed lecture5.pdf under "Heaps".')).toBeInTheDocument()
    expect(posts.some((url) => url.endsWith('/materials/m1/confirm'))).toBe(true)
    expect(screen.queryByText('Material analysed')).not.toBeInTheDocument()
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
