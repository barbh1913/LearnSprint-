import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScheduleBlock } from '../../types'
import { WeekGrid } from './WeekGrid'

const weekStart = new Date(2026, 8, 13) // Sunday
const today = new Date(2026, 8, 16)

function block(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    start: '2026-09-14T18:00:00',
    end: '2026-09-14T19:30:00',
    durationMinutes: 90,
    blockType: 'action',
    topicId: 't1',
    topicName: 'Trees',
    actionType: 'read',
    actionId: 'a1',
    label: 'Read: Trees',
    courseId: 'c1',
    courseName: 'Data Structures',
    ...overrides,
  }
}

const range = { startHour: 15, endHour: 23 }

describe('WeekGrid', () => {
  it('shows the seven days with today marked', () => {
    render(
      <WeekGrid weekStart={weekStart} blocks={[]} range={range} today={today} onSelectBlock={vi.fn()} />,
    )

    expect(screen.getByText('Sun')).toBeInTheDocument()
    expect(screen.getByText('Sat')).toBeInTheDocument()
    expect(screen.getByText('16')).toHaveClass('bg-primary')
  })

  it('labels every visible hour, including the first', () => {
    render(
      <WeekGrid weekStart={weekStart} blocks={[]} range={range} today={today} onSelectBlock={vi.fn()} />,
    )

    expect(screen.getByText('15:00')).toBeInTheDocument()
    expect(screen.getByText('22:00')).toBeInTheDocument()
    expect(screen.queryByText('23:00')).not.toBeInTheDocument()
  })

  it('never lets a short session overrun the one after it', () => {
    const sliver = block({
      start: '2026-09-14T15:00:00',
      end: '2026-09-14T15:10:00',
      durationMinutes: 10,
      label: 'Summarize: Trees',
    })
    const next = block({
      start: '2026-09-14T15:10:00',
      end: '2026-09-14T15:40:00',
      durationMinutes: 30,
      label: 'Quiz: Trees',
    })
    render(
      <WeekGrid
        weekStart={weekStart}
        blocks={[next, sliver]}
        range={range}
        today={today}
        onSelectBlock={vi.fn()}
      />,
    )

    const first = screen.getByRole('button', { name: /Summarize: Trees/ })
    const second = screen.getByRole('button', { name: /Quiz: Trees/ })
    // 10 minutes is 8px; the 18px legibility minimum would cover the quiz that starts at 8px.
    expect(first.style.top).toBe('0px')
    expect(first.style.height).toBe('6px')
    expect(second.style.top).toBe('8px')
    expect(second.style.height).toBe('22px')
  })

  it('places an event by its start time and length', () => {
    render(
      <WeekGrid
        weekStart={weekStart}
        blocks={[block()]}
        range={range}
        today={today}
        onSelectBlock={vi.fn()}
      />,
    )

    const event = screen.getByRole('button', { name: /Read: Trees/ })
    // 18:00 is three hours into a 15:00 grid at 48px per hour; 90 minutes is 72px minus a 2px gap.
    expect(event.style.top).toBe('144px')
    expect(event.style.height).toBe('70px')
  })

  it('opens a topic event, but a study-aid block is not clickable', () => {
    const onSelectBlock = vi.fn()
    const studyAid = block({
      start: '2026-09-15T18:00:00',
      end: '2026-09-15T19:00:00',
      blockType: 'study_aid',
      topicId: null,
      topicName: null,
      actionType: null,
      actionId: null,
      label: 'Prepare exam study aids',
    })
    render(
      <WeekGrid
        weekStart={weekStart}
        blocks={[block(), studyAid]}
        range={range}
        today={today}
        onSelectBlock={onSelectBlock}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Read: Trees/ }))
    expect(onSelectBlock).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'a1' }))

    expect(screen.getByText('Prepare exam study aids')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /study aids/ })).not.toBeInTheDocument()
  })

  it('labels each session with its course only when asked to', () => {
    const { rerender } = render(
      <WeekGrid weekStart={weekStart} blocks={[block()]} range={range} today={today} onSelectBlock={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Read: Trees, 06:00 PM–07:30 PM' })).toBeInTheDocument()
    expect(screen.queryByText('Data Structures')).not.toBeInTheDocument()

    rerender(
      <WeekGrid
        weekStart={weekStart}
        blocks={[block()]}
        range={range}
        today={today}
        showCourse
        onSelectBlock={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Read: Trees, Data Structures, 06:00 PM–07:30 PM' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Data Structures')).toBeInTheDocument()
  })

  it('leaves out blocks from other weeks', () => {
    render(
      <WeekGrid
        weekStart={weekStart}
        blocks={[block({ start: '2026-09-21T18:00:00', end: '2026-09-21T19:00:00' })]}
        range={range}
        today={today}
        onSelectBlock={vi.fn()}
      />,
    )

    expect(screen.queryByText('Read: Trees')).not.toBeInTheDocument()
  })
})
