import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarPage } from './CalendarPage'

const dataStructures = {
  id: 'c1',
  name: 'Data Structures',
  year: 2,
  semester: 'A',
  credits: 4,
  examDate: '2026-10-01',
  examType: 'closed',
  role: 'owner',
}
const oop = { ...dataStructures, id: 'c2', name: 'OOP', examDate: '2026-10-20' }

// Topic events (ADR 0012): the Calendar draws these, not the per-action blocks.
const treesEvent = {
  topicId: 't1',
  topicName: 'Trees',
  kind: 'study',
  start: '2026-09-14T18:00:00',
  end: '2026-09-14T19:00:00',
  durationMinutes: 60,
  label: 'Trees',
  actions: [{ actionId: 'a1', title: 'Read', minutes: 60 }],
  courseId: 'c1',
  courseName: 'Data Structures',
}
const classesEvent = {
  ...treesEvent,
  topicId: 't2',
  topicName: 'Classes',
  start: '2026-09-15T18:00:00',
  end: '2026-09-15T19:00:00',
  label: 'Classes',
  actions: [{ actionId: 'a2', title: 'Read', minutes: 60 }],
  courseId: 'c2',
  courseName: 'OOP',
}

const courseSchedule = (course: typeof dataStructures, events: (typeof treesEvent)[]) => ({
  courseId: course.id,
  courseName: course.name,
  examDate: course.examDate,
  feasible: true,
  isEmergencyMode: false,
  totalAvailableMinutes: 600,
  totalNeededMinutes: 60 * events.length,
  blocks: [],
  events,
})

const plan = {
  courses: [courseSchedule(dataStructures, [treesEvent]), courseSchedule(oop, [classesEvent])],
  blocks: [],
  events: [treesEvent, classesEvent],
  totalAvailableMinutes: 900,
  totalNeededMinutes: 120,
  sessions: 2,
}

const singleSchedule = {
  feasible: true,
  isEmergencyMode: false,
  totalAvailableMinutes: 600,
  totalNeededMinutes: 60,
  blocks: [],
  events: [treesEvent],
}

const card = (topicId: string, courseId: string, courseName: string, name: string, actionId: string) => ({
  topicId,
  courseId,
  courseName,
  name,
  description: null,
  priority: 'medium',
  isPriority: false,
  masteryLevel: null,
  status: 'todo',
  needsMasteryRating: false,
  actions: [
    { id: actionId, type: 'read', title: 'Read', order: 0, durationMinutes: 60, isDone: false },
    { id: `${actionId}-s`, type: 'summarize', title: 'Summarize', order: 1, durationMinutes: 30, isDone: false },
    { id: `${actionId}-q`, type: 'quiz', title: 'Quiz', order: 2, durationMinutes: 30, isDone: false },
  ],
  actionsDone: 0,
  totalMinutes: 120,
})

const board = {
  columns: {},
  cards: [card('t1', 'c1', 'Data Structures', 'Trees', 'a1'), card('t2', 'c2', 'OOP', 'Classes', 'a2')],
  totalTopics: 2,
  doneTopics: 0,
}

const googleOff = { configured: false, connected: false, connectedAt: null, lastSyncedAt: null }

function mockApi(responses: Record<string, unknown>) {
  const all: Record<string, unknown> = { '/integrations/google-calendar/status': googleOff, ...responses }
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace(/^.*\/api/, '')
      calls.push(path)
      // Longest prefix wins, so "/schedule.ics" isn't swallowed by "/schedule".
      const match = Object.keys(all)
        .sort((a, b) => b.length - a.length)
        .find((key) => path.startsWith(key))
      if (!match) throw new Error(`Unexpected request: ${url}`)
      const body = all[match]
      return {
        ok: true,
        status: 200,
        json: async () => body,
        blob: async () => new Blob([String(body)]),
      }
    }),
  )
  return calls
}

const defaultResponses = {
  '/courses': [dataStructures, oop],
  '/courses/c2/topics/t2/materials': [],
  '/schedule': plan,
  '/courses/c1/schedule': singleSchedule,
  '/board': board,
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
  it('opens on all courses, labelling each session with its course', async () => {
    mockApi(defaultResponses)

    renderPage()

    expect(await screen.findByRole('button', { name: /Trees, Data Structures/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Classes, OOP/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter by course' })).toHaveValue('')
    expect(screen.getByText('Free time until your last exam')).toBeInTheDocument()
    expect(screen.getByText('15h')).toBeInTheDocument()
    expect(screen.getByText('2h')).toBeInTheDocument()
    expect(screen.getByText('Sessions').nextSibling).toHaveTextContent('2')
  })

  it('filters to one course as a slice of the same plan, without the course label', async () => {
    const calls = mockApi(defaultResponses)
    renderPage()
    await screen.findByRole('button', { name: /Classes, OOP/ })

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by course' }), {
      target: { value: 'c1' },
    })

    expect(await screen.findByText('Free time before exam')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trees, 06:00 PM–07:00 PM' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Classes/ })).not.toBeInTheDocument()
    expect(calls).toContain('/courses/c1/schedule')
    expect(calls).toContain('/board?courseId=c1')
  })

  it('names the course whose plan does not fit while still showing the others', async () => {
    mockApi({
      ...defaultResponses,
      '/schedule': {
        ...plan,
        courses: [
          plan.courses[0],
          {
            ...courseSchedule(oop, []),
            feasible: false,
            reason: 'Not enough free time before the exam.',
            shortfallMinutes: 90,
          },
        ],
        events: [treesEvent],
        sessions: 1,
      },
    })

    renderPage()

    expect(await screen.findByText("OOP: this plan doesn't fit")).toBeInTheDocument()
    expect(screen.getByText(/1h 30m more free time before this exam/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Trees/ })).toBeInTheDocument()
  })

  it('flags a course in emergency mode by name', async () => {
    mockApi({
      ...defaultResponses,
      '/schedule': {
        ...plan,
        courses: [plan.courses[0], { ...plan.courses[1], isEmergencyMode: true }],
      },
    })

    renderPage()

    expect(await screen.findByText('OOP: emergency mode')).toBeInTheDocument()
    expect(screen.queryByText(/Data Structures: emergency/)).not.toBeInTheDocument()
  })

  it('downloads the whole plan as one .ics when showing all courses', async () => {
    const calls = mockApi({ ...defaultResponses, '/schedule.ics': 'BEGIN:VCALENDAR' })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:plan'), revokeObjectURL: vi.fn() })
    renderPage()
    await screen.findByRole('button', { name: /Trees/ })

    fireEvent.click(screen.getByRole('button', { name: 'Download .ics' }))

    await waitFor(() => expect(calls).toContain('/schedule.ics'))
  })

  it('explains that there is no plan when no course has an exam date', async () => {
    mockApi({
      ...defaultResponses,
      '/schedule': { courses: [], blocks: [], events: [], totalAvailableMinutes: 0, totalNeededMinutes: 0, sessions: 0 },
    })

    renderPage()

    expect(await screen.findByText('No study plan yet')).toBeInTheDocument()
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument()
  })

  it('moves between weeks', async () => {
    mockApi(defaultResponses)
    renderPage()
    await screen.findByRole('button', { name: /Trees/ })

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))

    expect(screen.queryByRole('button', { name: /Trees/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Sep 20/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('button', { name: /Trees/ })).toBeInTheDocument()
  })

  it('switches to a month overview and back to the week of a clicked day', async () => {
    mockApi(defaultResponses)
    renderPage()
    await screen.findByRole('button', { name: /Trees/ })

    fireEvent.click(screen.getByRole('button', { name: 'Month' }))

    expect(screen.getByText('September 2026')).toBeInTheDocument()
    expect(screen.getByText('Trees')).toBeInTheDocument()
    expect(screen.getByText('Data Structures ·')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trees/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Monday, September 14' }))

    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Trees/ })).toBeInTheDocument()
    expect(screen.getByText(/Sep 13/)).toBeInTheDocument()
  })

  it('opens the topic behind an event with that action highlighted', async () => {
    mockApi(defaultResponses)
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /Classes/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Topic name')).toHaveValue('Classes')
    expect(screen.getByLabelText('Read done').closest('div')).toHaveClass('border-primary')
    expect(screen.getByLabelText('Quiz done').closest('div')).not.toHaveClass('border-primary')
  })

  it('explains an infeasible single course instead of drawing a grid', async () => {
    mockApi({
      ...defaultResponses,
      '/courses/c1/schedule': {
        feasible: false,
        reason: 'Not enough free time before the exam.',
        shortfallMinutes: 90,
        totalAvailableMinutes: 30,
        totalNeededMinutes: 120,
        blocks: [],
        events: [],
      },
    })
    renderPage()
    await screen.findByRole('button', { name: /Trees/ })

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by course' }), {
      target: { value: 'c1' },
    })

    await waitFor(() => expect(screen.getByText("This plan doesn't fit")).toBeInTheDocument())
    expect(screen.getByText(/1h 30m more free time\. Try/)).toBeInTheDocument()
    expect(screen.queryByText('Sun')).not.toBeInTheDocument()
  })
})
