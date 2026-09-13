import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CalendarItem } from './calendarMath'
import { WeekGrid } from './WeekGrid'

const weekStart = new Date(2026, 8, 13) // Sunday
const today = new Date(2026, 8, 16)

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'trees-1',
    start: '2026-09-14T18:00:00',
    end: '2026-09-14T19:30:00',
    durationMinutes: 90,
    kind: 'action',
    topicId: 't1',
    label: 'Trees',
    courseName: 'Data Structures',
    actionIds: ['a1', 'a2'],
    actionTitles: ['Read', 'Summarize'],
    ...overrides,
  }
}

const range = { startHour: 15, endHour: 23 }

function renderGrid(items: CalendarItem[], extra: Partial<React.ComponentProps<typeof WeekGrid>> = {}) {
  return render(
    <WeekGrid
      weekStart={weekStart}
      items={items}
      range={range}
      today={today}
      onSelectItem={vi.fn()}
      {...extra}
    />,
  )
}

describe('WeekGrid', () => {
  it('shows the seven days with today marked', () => {
    renderGrid([])

    expect(screen.getByText('Sun')).toBeInTheDocument()
    expect(screen.getByText('Sat')).toBeInTheDocument()
    expect(screen.getByText('16')).toHaveClass('bg-primary')
  })

  it('labels every visible hour, including the first', () => {
    renderGrid([])

    expect(screen.getByText('15:00')).toBeInTheDocument()
    expect(screen.getByText('22:00')).toBeInTheDocument()
    expect(screen.queryByText('23:00')).not.toBeInTheDocument()
  })

  it('places a topic event by its start time and length, with its subtasks in the tooltip', () => {
    renderGrid([item()])

    const event = screen.getByRole('button', { name: 'Trees, 06:00 PM–07:30 PM' })
    // 18:00 is three hours into a 15:00 grid at 48px per hour; 90 minutes is 72px minus a 2px gap.
    expect(event.style.top).toBe('144px')
    expect(event.style.height).toBe('70px')
    expect(event).toHaveAttribute('title', 'Trees, 06:00 PM–07:30 PM — Read, Summarize')
  })

  it('never lets a short session overrun the one after it', () => {
    const sliver = item({ id: 's', start: '2026-09-14T15:00:00', end: '2026-09-14T15:10:00', durationMinutes: 10, label: 'Sliver' })
    const next = item({ id: 'n', start: '2026-09-14T15:10:00', end: '2026-09-14T15:40:00', durationMinutes: 30, label: 'Next' })
    renderGrid([next, sliver])

    const first = screen.getByRole('button', { name: /^Sliver/ })
    const second = screen.getByRole('button', { name: /^Next/ })
    // 10 minutes is 8px; the 18px legibility minimum would cover the session that starts at 8px.
    expect(first.style.top).toBe('0px')
    expect(first.style.height).toBe('6px')
    expect(second.style.top).toBe('8px')
    expect(second.style.height).toBe('22px')
  })

  it('opens a topic event, but study-aid preparation is not clickable', () => {
    const onSelectItem = vi.fn()
    const studyAid = item({
      id: 'aid',
      start: '2026-09-15T18:00:00',
      end: '2026-09-15T19:00:00',
      kind: 'study_aid',
      topicId: null,
      label: 'Prepare exam study aids',
      actionIds: [],
      actionTitles: [],
    })
    renderGrid([item(), studyAid], { onSelectItem })

    fireEvent.click(screen.getByRole('button', { name: /^Trees/ }))
    expect(onSelectItem).toHaveBeenCalledWith(expect.objectContaining({ actionIds: ['a1', 'a2'] }))

    expect(screen.getByText('Prepare exam study aids')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /study aids/ })).not.toBeInTheDocument()
  })

  it('labels each session with its course only when asked to', () => {
    const { rerender } = renderGrid([item()])
    expect(screen.getByRole('button', { name: 'Trees, 06:00 PM–07:30 PM' })).toBeInTheDocument()
    expect(screen.queryByText('Data Structures')).not.toBeInTheDocument()

    rerender(
      <WeekGrid weekStart={weekStart} items={[item()]} range={range} today={today} showCourse onSelectItem={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Trees, Data Structures, 06:00 PM–07:30 PM' })).toBeInTheDocument()
    expect(screen.getByText('Data Structures')).toBeInTheDocument()
  })

  it('leaves out sessions from other weeks', () => {
    renderGrid([item({ start: '2026-09-21T18:00:00', end: '2026-09-21T19:00:00' })])

    expect(screen.queryByText('Trees')).not.toBeInTheDocument()
  })
})
