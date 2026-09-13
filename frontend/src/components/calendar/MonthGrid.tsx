import { cn } from '../../lib/utils'
import type { ScheduleBlock } from '../../types'
import { DAY_LABELS, blocksOnDay, isSameDay, monthGrid } from './calendarMath'

const MAX_CHIPS_PER_DAY = 3

const CHIP_STYLES: Record<ScheduleBlock['blockType'], string> = {
  action: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  review: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200',
  study_aid: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
}

/**
 * The month overview (FR6.1): six weeks of day cells, each listing its sessions
 * as compact chips. It is a map, not a workspace - clicking a day hands off to
 * the week view, where events have real height and can be opened.
 */
export function MonthGrid({
  month,
  blocks,
  today,
  showCourse = false,
  onSelectDay,
}: {
  month: Date
  blocks: ScheduleBlock[]
  today: Date
  /** Prefix each chip with its course - on when several courses share the grid. */
  showCourse?: boolean
  onSelectDay: (day: Date) => void
}) {
  const days = monthGrid(month)

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-border">
          {DAY_LABELS.map((label) => (
            <div key={label} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const inMonth = day.getMonth() === month.getMonth()
            const isToday = isSameDay(day, today)
            const dayBlocks = blocksOnDay(blocks, day)
            const overflow = dayBlocks.length - MAX_CHIPS_PER_DAY

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => onSelectDay(day)}
                aria-label={day.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
                className={cn(
                  'flex min-h-24 flex-col items-stretch gap-1 border-border p-1.5 text-left hover:bg-muted',
                  index % 7 !== 0 && 'border-l',
                  index >= 7 && 'border-t',
                  !inMonth && 'bg-muted/30 text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-6 items-center justify-center self-end rounded-full text-xs font-medium',
                    isToday && 'bg-primary text-primary-foreground',
                  )}
                >
                  {day.getDate()}
                </span>

                {dayBlocks.slice(0, MAX_CHIPS_PER_DAY).map((block, blockIndex) => (
                  <span
                    key={`${block.start}-${blockIndex}`}
                    className={cn(
                      'block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight',
                      CHIP_STYLES[block.blockType],
                    )}
                    title={showCourse && block.courseName ? `${block.courseName} · ${block.label}` : block.label}
                  >
                    {showCourse && block.courseName && (
                      <span className="font-medium">{block.courseName} · </span>
                    )}
                    {block.label}
                  </span>
                ))}
                {overflow > 0 && (
                  <span className="px-1.5 text-[11px] text-muted-foreground">+{overflow} more</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
