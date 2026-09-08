import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseMembers } from './CourseMembers'

const owner = {
  userId: 'u-owner',
  email: 'owner@example.com',
  role: 'owner',
  topicsTotal: 4,
  topicsDone: 2,
  percentComplete: 50,
}

const peer = {
  userId: 'u-peer',
  email: 'peer@example.com',
  role: 'member',
  topicsTotal: 4,
  topicsDone: 1,
  percentComplete: 25,
}

function mockMembers(members: object[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => members }),
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CourseMembers', () => {
  it('shows each member with their completion', async () => {
    mockMembers([{ ...owner, isMe: true }, { ...peer, isMe: false }])

    render(<CourseMembers courseId="c1" />)

    expect(await screen.findByRole('heading', { name: 'Study group' })).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('peer@example.com')).toBeInTheDocument()
    expect(screen.getByText('2/4 done')).toBeInTheDocument()
    expect(screen.getByText('1/4 done')).toBeInTheDocument()

    const bars = screen.getAllByRole('progressbar')
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['50', '25'])
  })

  it('lets the owner invite, but not a member', async () => {
    mockMembers([{ ...owner, isMe: true }, { ...peer, isMe: false }])
    const { unmount } = render(<CourseMembers courseId="c1" />)

    expect(
      await screen.findByLabelText('Invite a classmate by email'),
    ).toBeInTheDocument()
    unmount()

    mockMembers([{ ...owner, isMe: false }, { ...peer, isMe: true }])
    render(<CourseMembers courseId="c1" />)

    await screen.findByRole('heading', { name: 'Study group' })
    expect(screen.queryByLabelText('Invite a classmate by email')).not.toBeInTheDocument()
  })

  it('never renders a grade even if one arrives in the response', async () => {
    // The API is tested to never send this. This checks that if it ever did,
    // the component still wouldn't show it - it only reads the fields it knows.
    mockMembers([{ ...owner, isMe: false, finalGrade: 95 }, { ...peer, isMe: true }])

    const { container } = render(<CourseMembers courseId="c1" />)

    await screen.findByRole('heading', { name: 'Study group' })
    expect(container.textContent).not.toContain('95')
    expect(container.textContent).not.toContain('finalGrade')
  })
})
