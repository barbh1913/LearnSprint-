import { cn } from '../../lib/utils'
import type { BlockType } from '../../types'
import {
  DAY_LABELS,
  formatTime,
  isSameDay,
  itemsOnDay,
  placement,
  weekDays,
  type CalendarItem,
  type HourRange,
} from './calendarMath'

const HOUR_PX = 48
const MIN_EVENT_PX = 18
// A short session is stretched to MIN_EVENT_PX for legibility, but never into
// the session after it - that one wins the space; the tooltip carries the rest.
const EVENT_GAP_PX = 2
const FLOOR_EVENT_PX = 4
const GRID_COLUMNS = 'grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]'

// Same colour language as the board: green for study sessions, indigo for the
// review session, amber for study-aid preparation.
const KIND_STYLES: Record<BlockType, string> = {
  action:
    'border-l-emerald-500 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-100 dark:hover:bg-emerald-900/60',
  review:
    'border-l-indigo-500 bg-indigo-50 text-indigo-950 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-100 dark:hover:bg-indigo-900/60',
  study_aid:
    'border-l-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-100 dark:hover:bg-amber-900/60',
}

/**
 * One week of the plan as a time grid (FR6.1): seven day columns, one row per
 * hour, each topic event placed at its planned time. The scheduler guarantees
 * sessions never overlap, so there is no lane-splitting to do.
 */
export function WeekGrid({
  weekStart,
  items,
  range,
  today,
  showCourse = false,
  onSelectItem,
}: {
  weekStart: Date
  items: CalendarItem[]
  range: HourRange
  today: Date
  /** Label each session with its course - on when several courses share the grid. */
  showCourse?: boolean
  onSelectItem: (item: CalendarItem) => void
}) {
  const days = weekDays(weekStart)
  const hours = Array.from(
    { length: range.endHour - range.startHour },
    (_, index) => range.startHour + index,
  )
  const columnHeight = hours.length * HOUR_PX

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="min-w-[640px]">
        <div className={cn('grid border-b border-border', GRID_COLUMNS)}>
          <div />
          {days.map((day) => {
            const isToday = isSameDay(day, today)
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'border-l border-border px-2 py-2 text-center text-xs',
                  isToday ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <div className="font-medium">{DAY_LABELS[day.getDay()]}</div>
                <div
                  className={cn(
                    'mt-0.5 inline-flex size-7 items-center justify-center rounded-full text-base font-semibold',
                    isToday && 'bg-primary text-primary-foreground',
                  )}
                >
                  {day.getDate()}
                </div>
              </div>
            )
          })}
        </div>

        <div className={cn('grid', GRID_COLUMNS)}>
          <div className="relative" style={{ height: columnHeight }}>
            {hours.map((hour, index) => (
              <span
                key={hour}
                className={cn(
                  'absolute right-2 text-[10px] text-muted-foreground',
                  // The first label sits under the header instead of straddling it.
                  index > 0 && '-translate-y-1/2',
                )}
                style={{ top: index * HOUR_PX }}
              >
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="relative border-l border-border"
              style={{ height: columnHeight }}
            >
              {hours.map((hour, index) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: index * HOUR_PX }}
                  aria-hidden
                />
              ))}

              {layoutDay(itemsOnDay(items, day), range).map(({ item, spot, style }) => {
                const timeRange = `${formatTime(item.start)}–${formatTime(item.end)}`
                const courseLabel = showCourse ? item.courseName : null
                const className = cn(
                  'absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight',
                  KIND_STYLES[item.kind],
                )
                // A session shows as much as its height allows: label, then its course, then its times.
                const content = (
                  <>
                    <span className="block truncate font-medium">{item.label}</span>
                    {courseLabel && spot.height >= 45 && (
                      <span className="block truncate text-[10px] opacity-70">{courseLabel}</span>
                    )}
                    {spot.height >= (courseLabel ? 70 : 45) && (
                      <span className="block truncate opacity-70">{timeRange}</span>
                    )}
                  </>
                )
                const description = [item.label, courseLabel, timeRange].filter(Boolean).join(', ')
                const tooltip = item.actionTitles.length > 0
                  ? `${description} — ${item.actionTitles.join(', ')}`
                  : description

                // Study-aid preparation belongs to no topic, so there is nothing to open.
                return item.topicId ? (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectItem(item)}
                    aria-label={description}
                    title={tooltip}
                    className={cn(className, 'cursor-pointer')}
                    style={style}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={item.id} className={className} style={style} title={tooltip}>
                    {content}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface LaidOutItem {
  item: CalendarItem
  spot: { top: number; height: number }
  style: { top: number; height: number }
}

/** Pixel boxes for one day's items, earliest first, with no box overrunning the next. */
function layoutDay(dayItems: CalendarItem[], range: HourRange): LaidOutItem[] {
  const placed = dayItems.flatMap((item) => {
    const spot = placement(item, range)
    return spot ? [{ item, spot }] : []
  })

  return placed.map(({ item, spot }, index) => {
    const top = (spot.top / 60) * HOUR_PX
    let height = Math.max((spot.height / 60) * HOUR_PX - EVENT_GAP_PX, MIN_EVENT_PX)

    const next = placed[index + 1]
    if (next) {
      const nextTop = (next.spot.top / 60) * HOUR_PX
      height = Math.min(height, Math.max(nextTop - top - EVENT_GAP_PX, FLOOR_EVENT_PX))
    }

    return { item, spot, style: { top, height } }
  })
}
