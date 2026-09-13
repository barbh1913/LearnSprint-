// Pure date helpers for the Calendar (FR6.1). No React, no API - so the grid's
// placement rules can be unit-tested without rendering anything.
//
// Block times arrive as ISO strings without a zone ("2026-09-10T18:00:00"),
// which `new Date` reads as local wall-clock time - the same naive-local
// convention the scheduler and the .ics export use.

import type { ScheduleBlock } from '../../types'

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export interface HourRange {
  startHour: number
  endHour: number
}

export const DEFAULT_HOUR_RANGE: HourRange = { startHour: 8, endHour: 20 }

const MINUTES_PER_DAY = 24 * 60

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Sunday 00:00 of the week containing `date` - the same week the sprint uses (FR4.0). */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  return addDays(day, -day.getDay())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Blocks that start on `day`, earliest first. The scheduler never crosses midnight, so the start is enough. */
export function blocksOnDay(blocks: ScheduleBlock[], day: Date): ScheduleBlock[] {
  return blocks
    .filter((block) => isSameDay(new Date(block.start), day))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

export function minutesIntoDay(iso: string): number {
  const date = new Date(iso)
  return date.getHours() * 60 + date.getMinutes()
}

/** A block ending exactly at midnight reads as 00:00; treat it as the end of its day. */
function endMinutesIntoDay(block: ScheduleBlock): number {
  const end = minutesIntoDay(block.end)
  return end === 0 ? MINUTES_PER_DAY : end
}

/** The tightest whole-hour range around the blocks, so the grid doesn't spend space on 03:00. */
export function hourRange(
  blocks: ScheduleBlock[],
  fallback: HourRange = DEFAULT_HOUR_RANGE,
): HourRange {
  if (blocks.length === 0) return fallback

  const startHour = Math.min(
    ...blocks.map((block) => Math.floor(minutesIntoDay(block.start) / 60)),
  )
  const endHour = Math.max(...blocks.map((block) => Math.ceil(endMinutesIntoDay(block) / 60)))
  return { startHour, endHour: Math.max(endHour, startHour + 1) }
}

/** Where a block sits in its day column, in minutes from the top of the visible range. Null if fully outside it. */
export function placement(
  block: ScheduleBlock,
  range: HourRange,
): { top: number; height: number } | null {
  const rangeStart = range.startHour * 60
  const rangeEnd = range.endHour * 60
  const start = Math.max(minutesIntoDay(block.start), rangeStart)
  const end = Math.min(endMinutesIntoDay(block), rangeEnd)
  if (end <= start) return null
  return { top: start - rangeStart, height: end - start }
}

/** The week to open on: this week, unless the whole plan lies ahead - then the plan's first week. */
export function initialWeekFor(blocks: ScheduleBlock[], today: Date): Date {
  const thisWeek = startOfWeek(today)
  if (blocks.length === 0) return thisWeek

  const firstStart = blocks.reduce((earliest, block) => {
    const start = new Date(block.start)
    return start < earliest ? start : earliest
  }, new Date(blocks[0].start))

  return firstStart >= addDays(thisWeek, 7) ? startOfWeek(firstStart) : thisWeek
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6)
  const from = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const to = weekEnd.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${from} – ${to}`
}
