import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CalendarItem } from './calendarMath'
import { MonthGrid } from './MonthGrid'

const september = new Date(2026, 8, 1)
const today = new Date(2026, 8, 16)

function item(start: string, label: string): CalendarItem {
  return {
    id: `${label}-${start}`,
    start,
    end: start.replace('T18', 'T19'),
    durationMinutes: 60,
    kind: 'action',
    topicId: 't1',
    label,
    courseName: 'Data Structures',
    actionIds: ['a1'],
    actionTitles: ['Read'],
  }
}

describe('MonthGrid', () => {
  it('lays out six weeks with the month in focus', () => {
    render(<MonthGrid month={september} items={[]} today={today} onSelectDay={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(42)
    expect(screen.getByRole('button', { name: 'Tuesday, September 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sunday, August 30' })).toHaveClass('text-muted-foreground')
  })

  it('lists a day’s sessions and folds the rest into a count', () => {
    const items = [
      item('2026-09-14T18:00:00', 'Trees'),
      item('2026-09-14T18:00:00', 'Graphs'),
      item('2026-09-14T18:00:00', 'Hashing'),
      item('2026-09-14T18:00:00', 'Sorting'),
    ]

    render(<MonthGrid month={september} items={items} today={today} onSelectDay={vi.fn()} />)

    expect(screen.getByText('Trees')).toBeInTheDocument()
    expect(screen.getByText('Hashing')).toBeInTheDocument()
    expect(screen.queryByText('Sorting')).not.toBeInTheDocument()
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('prefixes chips with the course when several courses share the grid', () => {
    const items = [item('2026-09-14T18:00:00', 'Trees')]

    render(<MonthGrid month={september} items={items} today={today} showCourse onSelectDay={vi.fn()} />)

    expect(screen.getByText('Data Structures ·')).toBeInTheDocument()
    expect(screen.getByTitle('Data Structures · Trees')).toBeInTheDocument()
  })

  it('hands the clicked day back', () => {
    const onSelectDay = vi.fn()
    render(<MonthGrid month={september} items={[]} today={today} onSelectDay={onSelectDay} />)

    fireEvent.click(screen.getByRole('button', { name: 'Monday, September 14' }))

    expect(onSelectDay).toHaveBeenCalledTimes(1)
    const [day] = onSelectDay.mock.calls[0] as [Date]
    expect(day.getDate()).toBe(14)
  })
})
