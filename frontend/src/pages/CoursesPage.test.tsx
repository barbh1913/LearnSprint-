import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CoursesPage } from './CoursesPage'

function course(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'c1',
    name: 'Data Structures',
    year: 2,
    semester: 'A',
    credits: 5,
    examDate: null,
    examType: 'closed',
    finalGrade: null,
    role: 'owner',
    ...overrides,
  }
}

function boardCard(courseId: string, status: string) {
  return {
    topicId: `${courseId}-t`,
    courseId,
    courseName: 'x',
    name: 'Topic',
    isPriority: false,
    masteryLevel: null,
    status,
    needsMasteryRating: false,
    actions: [],
    actionsDone: 0,
    totalMinutes: 0,
  }
}

function mockApi(courses: object[], boardCards: object[] = []) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/board')) {
      return { ok: true, status: 200, json: async () => ({ cards: boardCards }) }
    }
    if (url.includes('/courses')) {
      return { ok: true, status: 200, json: async () => courses }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/courses']}>
      <Routes>
        <Route path="/courses" element={<CoursesPage />} />
        <Route path="/courses/:courseId" element={<div>Course detail page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CoursesPage', () => {
  it('defaults the filter to the latest year/semester that has a course', async () => {
    mockApi([
      course({ id: 'old', name: 'Old Course', year: 1, semester: 'A' }),
      course({ id: 'new', name: 'New Course', year: 2, semester: 'B' }),
    ])

    renderPage()

    expect(await screen.findByText('New Course')).toBeInTheDocument()
    expect(screen.queryByText('Old Course')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Filter by year')).toHaveValue('2')
    expect(screen.getByLabelText('Filter by semester')).toHaveValue('B')
  })

  it('switching to All courses shows everything', async () => {
    mockApi([
      course({ id: 'old', name: 'Old Course', year: 1, semester: 'A' }),
      course({ id: 'new', name: 'New Course', year: 2, semester: 'B' }),
    ])
    renderPage()
    await screen.findByText('New Course')

    fireEvent.change(screen.getByLabelText('Filter by year'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Filter by semester'), { target: { value: 'all' } })

    expect(await screen.findByText('Old Course')).toBeInTheDocument()
    expect(screen.getByText('New Course')).toBeInTheDocument()
  })

  it('shows a done/total progress indicator derived from the global board', async () => {
    mockApi(
      [course({ id: 'c1', year: 3, semester: 'A' })],
      [boardCard('c1', 'done'), boardCard('c1', 'todo')],
    )

    renderPage()

    expect(await screen.findByText('1/2 topics')).toBeInTheDocument()
  })

  it('clicking the card navigates to the course detail page', async () => {
    mockApi([course({ id: 'c1', name: 'Data Structures', year: 3, semester: 'A' })])
    renderPage()

    fireEvent.click(await screen.findByText('Data Structures'))

    expect(await screen.findByText('Course detail page')).toBeInTheDocument()
  })

  it('editing or deleting a card does not also navigate to the detail page', async () => {
    mockApi([course({ id: 'c1', name: 'Data Structures', year: 3, semester: 'A' })])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await screen.findByText('Data Structures')

    fireEvent.click(screen.getByLabelText('Delete Data Structures'))
    expect(screen.queryByText('Course detail page')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Edit Data Structures'))
    expect(await screen.findByRole('heading', { name: 'Edit course' })).toBeInTheDocument()
    expect(screen.queryByText('Course detail page')).not.toBeInTheDocument()
  })

  it('a filter with no matching courses offers to show everything', async () => {
    mockApi([course({ id: 'c1', year: 3, semester: 'A' })])
    renderPage()
    await screen.findByLabelText('Filter by year')

    fireEvent.change(screen.getByLabelText('Filter by year'), { target: { value: '1' } })

    expect(await screen.findByText('No courses here')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all courses' }))
    await waitFor(() => expect(screen.getByLabelText('Filter by year')).toHaveValue('all'))
  })

  it('New course defaults to the currently selected year and semester', async () => {
    mockApi([course({ id: 'c1', year: 3, semester: 'B' })])
    renderPage()
    await screen.findByLabelText('Filter by year')

    fireEvent.click(screen.getByRole('button', { name: 'New course' }))

    await screen.findByRole('heading', { name: 'New course' })
    expect(screen.getByLabelText('Year')).toHaveValue('3')
    expect(screen.getByLabelText('Semester')).toHaveValue('B')
  })
})
