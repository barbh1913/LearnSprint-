// Pure date helpers for the Calendar (FR6.1). No React, no API - so the grid's
// placement rules can be unit-tested without rendering anything.
//
// Times arrive as ISO strings without a zone ("2026-09-10T18:00:00"), which
// `new Date` reads as local wall-clock time - the same naive-local convention
// the scheduler and the .ics export use.

import type { BlockType, ScheduleEvent } from '../../types'

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** What the grids draw: a topic event (ADR 0012) reduced to what a calendar cell needs. */
export interface CalendarItem {
  id: string
  start: string
  end: string
  durationMinutes: number
  kind: BlockType
  topicId: string | null
  label: string
  courseName: string | null
  actionIds: string[]
  actionTitles: string[]
}

const KIND_TO_BLOCK_TYPE: Record<ScheduleEvent['kind'], BlockType> = {
  study: 'action',
  review: 'review',
  study_aid: 'study_aid',
}

export function eventToItem(event: ScheduleEvent): CalendarItem {
  return {
    id: `${event.topicId ?? event.kind}-${event.start}`,
    start: event.start,
    end: event.end,
    durationMinutes: event.durationMinutes,
    kind: KIND_TO_BLOCK_TYPE[event.kind],
    topicId: event.topicId,
    label: event.label,
    courseName: event.courseName,
    actionIds: event.actions.map((action) => action.actionId),
    actionTitles: event.actions.map((action) => action.title),
  }
}

interface Timed {
  start: string
  end: string
}

export interface HourRange {
  startHour: number
  endHour: number
}

/** The study day the grid always shows, so weeks look alike whether or not they are busy. */
export const DEFAULT_HOUR_RANGE: HourRange = { startHour: 8, endHour: 23 }

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

/** Items that start on `day`, earliest first. The scheduler never crosses midnight, so the start is enough. */
export function itemsOnDay<T extends Timed>(items: T[], day: Date): T[] {
  return items
    .filter((item) => isSameDay(new Date(item.start), day))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

export function minutesIntoDay(iso: string): number {
  const date = new Date(iso)
  return date.getHours() * 60 + date.getMinutes()
}

/** An item ending exactly at midnight reads as 00:00; treat it as the end of its day. */
function endMinutesIntoDay(item: Timed): number {
  const end = minutesIntoDay(item.end)
  return end === 0 ? MINUTES_PER_DAY : end
}

/** The full study day, widened only if a session falls outside it - never narrowed, never hiding one. */
export function hourRange(items: Timed[], base: HourRange = DEFAULT_HOUR_RANGE): HourRange {
  if (items.length === 0) return base

  const earliest = Math.min(...items.map((item) => Math.floor(minutesIntoDay(item.start) / 60)))
  const latest = Math.max(...items.map((item) => Math.ceil(endMinutesIntoDay(item) / 60)))
  return {
    startHour: Math.min(base.startHour, earliest),
    endHour: Math.max(base.endHour, latest),
  }
}

/** Where an item sits in its day column, in minutes from the top of the visible range. Null if fully outside it. */
export function placement(item: Timed, range: HourRange): { top: number; height: number } | null {
  const rangeStart = range.startHour * 60
  const rangeEnd = range.endHour * 60
  const start = Math.max(minutesIntoDay(item.start), rangeStart)
  const end = Math.min(endMinutesIntoDay(item), rangeEnd)
  if (end <= start) return null
  return { top: start - rangeStart, height: end - start }
}

/** The day to open on: today, unless the whole plan lies ahead - then the plan's first day. */
export function initialCursorFor(items: Timed[], today: Date): Date {
  if (items.length === 0) return startOfDay(today)

  const firstStart = items.reduce((earliest, item) => {
    const start = new Date(item.start)
    return start < earliest ? start : earliest
  }, new Date(items[0].start))

  const nextWeek = addDays(startOfWeek(today), 7)
  return firstStart >= nextWeek ? startOfDay(firstStart) : startOfDay(today)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** Steps by whole months from the 1st, so Jan 31 + 1 month is Feb 1, not Mar 3. */
export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

const MONTH_GRID_DAYS = 6 * 7

/** The 42 days a month view shows: six full Sunday-to-Saturday rows around the month. */
export function monthGrid(date: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(date))
  return Array.from({ length: MONTH_GRID_DAYS }, (_, index) => addDays(gridStart, index))
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
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
