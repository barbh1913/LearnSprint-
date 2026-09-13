import { describe, expect, it } from 'vitest'
import type { ScheduleEvent } from '../../types'
import {
  addMonths,
  eventToItem,
  hourRange,
  initialCursorFor,
  itemsOnDay,
  monthGrid,
  placement,
  startOfWeek,
  weekDays,
  type CalendarItem,
} from './calendarMath'

function item(start: string, end: string, label = 'Trees'): CalendarItem {
  return {
    id: `${label}-${start}`,
    start,
    end,
    durationMinutes: 60,
    kind: 'action',
    topicId: 't1',
    label,
    courseName: 'Data Structures',
    actionIds: ['a1'],
    actionTitles: ['Read'],
  }
}

describe('eventToItem', () => {
  it('reduces a topic event to what the grid draws', () => {
    const event: ScheduleEvent = {
      topicId: 't1',
      topicName: 'Trees',
      kind: 'study',
      start: '2026-09-14T18:00:00',
      end: '2026-09-14T20:15:00',
      durationMinutes: 135,
      label: 'Trees',
      actions: [
        { actionId: 'a1', title: 'Read', minutes: 60 },
        { actionId: 'a2', title: 'Summarize', minutes: 45 },
      ],
      courseId: 'c1',
      courseName: 'Data Structures',
    }

    const result = eventToItem(event)

    expect(result).toMatchObject({
      kind: 'action',
      label: 'Trees',
      courseName: 'Data Structures',
      actionIds: ['a1', 'a2'],
      actionTitles: ['Read', 'Summarize'],
    })
    expect(eventToItem({ ...event, kind: 'review', actions: [] }).kind).toBe('review')
    expect(eventToItem({ ...event, kind: 'study_aid', topicId: null }).kind).toBe('study_aid')
  })
})

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

describe('itemsOnDay', () => {
  it('keeps only that day, earliest first', () => {
    const late = item('2026-09-14T20:00:00', '2026-09-14T21:00:00', 'late')
    const early = item('2026-09-14T18:00:00', '2026-09-14T19:00:00', 'early')
    const otherDay = item('2026-09-15T18:00:00', '2026-09-15T19:00:00', 'tomorrow')

    const result = itemsOnDay([late, otherDay, early], new Date(2026, 8, 14))

    expect(result.map((entry) => entry.label)).toEqual(['early', 'late'])
  })
})

describe('hourRange', () => {
  it('shows the whole study day when there is nothing to show', () => {
    expect(hourRange([])).toEqual({ startHour: 8, endHour: 23 })
  })

  it('keeps the whole study day even when the sessions only use the evening', () => {
    const range = hourRange([
      item('2026-09-14T15:30:00', '2026-09-14T16:15:00'),
      item('2026-09-15T21:00:00', '2026-09-15T22:45:00'),
    ])

    expect(range).toEqual({ startHour: 8, endHour: 23 })
  })

  it('widens for an early-morning session rather than hiding it', () => {
    const range = hourRange([item('2026-09-14T06:00:00', '2026-09-14T07:30:00')])

    expect(range).toEqual({ startHour: 6, endHour: 23 })
  })

  it('treats a session ending at midnight as ending at 24:00', () => {
    const range = hourRange([item('2026-09-14T22:00:00', '2026-09-15T00:00:00')])

    expect(range.endHour).toBe(24)
  })
})

describe('placement', () => {
  const range = { startHour: 15, endHour: 23 }

  it('measures from the top of the visible range', () => {
    const spot = placement(item('2026-09-14T16:30:00', '2026-09-14T17:15:00'), range)

    expect(spot).toEqual({ top: 90, height: 45 })
  })

  it('clips a session that runs past the range', () => {
    const spot = placement(item('2026-09-14T22:30:00', '2026-09-14T23:30:00'), range)

    expect(spot).toEqual({ top: 450, height: 30 })
  })

  it('drops a session entirely outside the range', () => {
    expect(placement(item('2026-09-14T06:00:00', '2026-09-14T07:00:00'), range)).toBeNull()
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
    const items = [item('2026-09-10T18:00:00', '2026-09-10T19:00:00')]

    expect(initialCursorFor(items, today).getDate()).toBe(16)
  })

  it('jumps to the first session when the whole plan is in a later week', () => {
    const items = [
      item('2026-09-28T18:00:00', '2026-09-28T19:00:00'),
      item('2026-09-22T18:00:00', '2026-09-22T19:00:00'),
    ]

    const cursor = initialCursorFor(items, today)

    expect(cursor.getMonth()).toBe(8)
    expect(cursor.getDate()).toBe(22)
    expect(cursor.getHours()).toBe(0)
  })
})
