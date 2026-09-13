import { describe, expect, it } from 'vitest'
import type { ScheduleBlock } from '../../types'
import {
  addMonths,
  blocksOnDay,
  hourRange,
  initialCursorFor,
  monthGrid,
  placement,
  startOfWeek,
  weekDays,
} from './calendarMath'

function block(start: string, end: string, label = 'Read: Trees'): ScheduleBlock {
  return {
    start,
    end,
    durationMinutes: 60,
    blockType: 'action',
    topicId: 't1',
    topicName: 'Trees',
    actionType: 'read',
    actionId: 'a1',
    label,
  }
}

describe('startOfWeek', () => {
  it('goes back to Sunday at midnight', () => {
    // 2026-09-16 is a Wednesday.
    const sunday = startOfWeek(new Date(2026, 8, 16, 15, 30))

    expect(sunday.getDay()).toBe(0)
    expect(sunday.getDate()).toBe(13)
    expect(sunday.getHours()).toBe(0)
  })

  it('keeps a Sunday where it is', () => {
    expect(startOfWeek(new Date(2026, 8, 13, 9)).getDate()).toBe(13)
  })
})

describe('weekDays', () => {
  it('returns seven consecutive days from the given start', () => {
    const days = weekDays(new Date(2026, 8, 13))

    expect(days).toHaveLength(7)
    expect(days.map((day) => day.getDate())).toEqual([13, 14, 15, 16, 17, 18, 19])
  })
})

describe('blocksOnDay', () => {
  it('keeps only that day, earliest first', () => {
    const late = block('2026-09-14T20:00:00', '2026-09-14T21:00:00', 'late')
    const early = block('2026-09-14T18:00:00', '2026-09-14T19:00:00', 'early')
    const otherDay = block('2026-09-15T18:00:00', '2026-09-15T19:00:00', 'tomorrow')

    const result = blocksOnDay([late, otherDay, early], new Date(2026, 8, 14))

    expect(result.map((item) => item.label)).toEqual(['early', 'late'])
  })
})

describe('hourRange', () => {
  it('falls back when there is nothing to show', () => {
    expect(hourRange([])).toEqual({ startHour: 8, endHour: 20 })
  })

  it('wraps the blocks in whole hours', () => {
    const range = hourRange([
      block('2026-09-14T15:30:00', '2026-09-14T16:15:00'),
      block('2026-09-15T21:00:00', '2026-09-15T22:45:00'),
    ])

    expect(range).toEqual({ startHour: 15, endHour: 23 })
  })

  it('treats a block ending at midnight as ending at 24:00', () => {
    const range = hourRange([block('2026-09-14T22:00:00', '2026-09-15T00:00:00')])

    expect(range.endHour).toBe(24)
  })
})

describe('placement', () => {
  const range = { startHour: 15, endHour: 23 }

  it('measures from the top of the visible range', () => {
    const spot = placement(block('2026-09-14T16:30:00', '2026-09-14T17:15:00'), range)

    expect(spot).toEqual({ top: 90, height: 45 })
  })

  it('clips a block that runs past the range', () => {
    const spot = placement(block('2026-09-14T22:30:00', '2026-09-14T23:30:00'), range)

    expect(spot).toEqual({ top: 450, height: 30 })
  })

  it('drops a block entirely outside the range', () => {
    expect(placement(block('2026-09-14T06:00:00', '2026-09-14T07:00:00'), range)).toBeNull()
  })
})

describe('monthGrid', () => {
  it('covers six Sunday-to-Saturday rows around the month', () => {
    // September 2026 starts on a Tuesday.
    const days = monthGrid(new Date(2026, 8, 16))

    expect(days).toHaveLength(42)
    expect(days[0].getDay()).toBe(0)
    expect(days[0].getMonth()).toBe(7)
    expect(days[0].getDate()).toBe(30)
    expect(days[2].getDate()).toBe(1)
    expect(days[41].getMonth()).toBe(9)
    expect(days[41].getDate()).toBe(10)
  })
})

describe('addMonths', () => {
  it('lands on the first of the target month even from a long month', () => {
    const next = addMonths(new Date(2026, 0, 31), 1)

    expect(next.getMonth()).toBe(1)
    expect(next.getDate()).toBe(1)
  })
})

describe('initialCursorFor', () => {
  const today = new Date(2026, 8, 16, 11, 45) // Wednesday

  it('opens on today when there is no plan', () => {
    expect(initialCursorFor([], today).getDate()).toBe(16)
  })

  it('opens on today when the plan has already started', () => {
    const blocks = [block('2026-09-10T18:00:00', '2026-09-10T19:00:00')]

    expect(initialCursorFor(blocks, today).getDate()).toBe(16)
  })

  it('jumps to the first session when the whole plan is in a later week', () => {
    const blocks = [
      block('2026-09-28T18:00:00', '2026-09-28T19:00:00'),
      block('2026-09-22T18:00:00', '2026-09-22T19:00:00'),
    ]

    const cursor = initialCursorFor(blocks, today)

    expect(cursor.getMonth()).toBe(8)
    expect(cursor.getDate()).toBe(22)
    expect(cursor.getHours()).toBe(0)
  })
})
