import { cn } from '../../lib/utils'
import type { ScheduleBlock } from '../../types'
import {
  DAY_LABELS,
  blocksOnDay,
  formatTime,
  isSameDay,
  placement,
  weekDays,
  type HourRange,
} from './calendarMath'

const HOUR_PX = 48
const MIN_EVENT_PX = 18
// A short session is stretched to MIN_EVENT_PX for legibility, but never into
// the session after it - that one wins the space; the tooltip carries the rest.
const EVENT_GAP_PX = 2
const FLOOR_EVENT_PX = 4
const GRID_COLUMNS = 'grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]'

// Same colour language as the board and the old list: green for actions,
// indigo for the review session, amber for study-aid preparation.
const BLOCK_STYLES: Record<ScheduleBlock['blockType'], string> = {
  action:
    'border-l-emerald-500 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-100 dark:hover:bg-emerald-900/60',
  review:
    'border-l-indigo-500 bg-indigo-50 text-indigo-950 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-100 dark:hover:bg-indigo-900/60',
  study_aid:
    'border-l-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-100 dark:hover:bg-amber-900/60',
}

/**
 * One week of the plan as a time grid (FR6.1): seven day columns, one row per
 * hour, each block placed at its planned time. The scheduler guarantees blocks
 * never overlap, so there is no lane-splitting to do.
 */
export function WeekGrid({
  weekStart,
  blocks,
  range,
  today,
  onSelectBlock,
}: {
  weekStart: Date
  blocks: ScheduleBlock[]
  range: HourRange
  today: Date
  onSelectBlock: (block: ScheduleBlock) => void
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

              {layoutDay(blocksOnDay(blocks, day), range).map(({ block, spot, style }, index) => {
                const timeRange = `${formatTime(block.start)}–${formatTime(block.end)}`
                const className = cn(
                  'absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight',
                  BLOCK_STYLES[block.blockType],
                )
                const content = (
                  <>
                    <span className="block truncate font-medium">{block.label}</span>
                    {spot.height >= 45 && (
                      <span className="block truncate opacity-70">{timeRange}</span>
                    )}
                  </>
                )

                // Study-aid blocks belong to no topic, so there is nothing to open.
                return block.topicId ? (
                  <button
                    key={`${block.start}-${index}`}
                    type="button"
                    onClick={() => onSelectBlock(block)}
                    aria-label={`${block.label}, ${timeRange}`}
                    className={cn(className, 'cursor-pointer')}
                    style={style}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={`${block.start}-${index}`}
                    className={className}
                    style={style}
                    title={timeRange}
                  >
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

interface LaidOutBlock {
  block: ScheduleBlock
  spot: { top: number; height: number }
  style: { top: number; height: number }
}

/** Pixel boxes for one day's blocks, earliest first, with no box overrunning the next. */
function layoutDay(dayBlocks: ScheduleBlock[], range: HourRange): LaidOutBlock[] {
  const placed = dayBlocks.flatMap((block) => {
    const spot = placement(block, range)
    return spot ? [{ block, spot }] : []
  })

  return placed.map(({ block, spot }, index) => {
    const top = (spot.top / 60) * HOUR_PX
    let height = Math.max((spot.height / 60) * HOUR_PX - EVENT_GAP_PX, MIN_EVENT_PX)

    const next = placed[index + 1]
    if (next) {
      const nextTop = (next.spot.top / 60) * HOUR_PX
      height = Math.min(height, Math.max(nextTop - top - EVENT_GAP_PX, FLOOR_EVENT_PX))
    }

    return { block, spot, style: { top, height } }
  })
}
