import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScheduleBlock } from '../../types'
import { MonthGrid } from './MonthGrid'

const september = new Date(2026, 8, 1)
const today = new Date(2026, 8, 16)

function block(start: string, label: string): ScheduleBlock {
  return {
    start,
    end: start.replace('T18', 'T19'),
    durationMinutes: 60,
    blockType: 'action',
    topicId: 't1',
    topicName: 'Trees',
    actionType: 'read',
    actionId: 'a1',
    label,
  }
}

describe('MonthGrid', () => {
  it('lays out six weeks with the month in focus', () => {
    render(<MonthGrid month={september} blocks={[]} today={today} onSelectDay={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(42)
    expect(screen.getByRole('button', { name: 'Tuesday, September 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sunday, August 30' })).toHaveClass('text-muted-foreground')
  })

  it('lists a day’s sessions and folds the rest into a count', () => {
    const blocks = [
      block('2026-09-14T18:00:00', 'Read: Trees'),
      block('2026-09-14T18:00:00', 'Summarize: Trees'),
      block('2026-09-14T18:00:00', 'Quiz: Trees'),
      block('2026-09-14T18:00:00', 'Read: Graphs'),
    ]

    render(<MonthGrid month={september} blocks={blocks} today={today} onSelectDay={vi.fn()} />)

    expect(screen.getByText('Read: Trees')).toBeInTheDocument()
    expect(screen.getByText('Quiz: Trees')).toBeInTheDocument()
    expect(screen.queryByText('Read: Graphs')).not.toBeInTheDocument()
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('hands the clicked day back', () => {
    const onSelectDay = vi.fn()
    render(<MonthGrid month={september} blocks={[]} today={today} onSelectDay={onSelectDay} />)

    fireEvent.click(screen.getByRole('button', { name: 'Monday, September 14' }))

    expect(onSelectDay).toHaveBeenCalledTimes(1)
    const [day] = onSelectDay.mock.calls[0] as [Date]
    expect(day.getDate()).toBe(14)
  })
})
