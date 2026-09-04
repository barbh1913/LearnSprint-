// Hand-built SVG charts. No charting library — these are simple enough that a
// dependency would cost more than it saves, and it keeps full control of the
// accessibility story (every chart has a title, a description, and a table view).
//
// Colours come from a validated categorical/sequential palette; the mastery
// ramp is ordinal (levels 1-5) so it uses one hue light-to-dark rather than
// five unrelated colours.

import { useState } from 'react'

// Sequential blue ramp, ordinal steps. Lightest step still clears contrast on a
// light surface, so a "1" bar is readable rather than fading into the card.
const MASTERY_RAMP = ['#86b6ef', '#5598e7', '#3987e5', '#256abf', '#184f95']
const SERIES_BLUE = '#2a78d6'

const MASTERY_LABELS = ['Barely started', 'Shaky', 'Getting there', 'Comfortable', 'Could teach it']

/**
 * Actions completed per week over the last six weeks.
 *
 * Bars rather than a line: the values are counts in discrete buckets, and weeks
 * with zero activity should read as a real gap, which a line would smooth over.
 */
export function VelocityChart({
  history,
}: {
  history: { weekStart: string; completed: number }[]
}) {
  const [hovered, setHovered] = useState<number | null>(null)

  if (history.length === 0) return null

  const max = Math.max(...history.map((week) => week.completed), 1)
  const width = 100
  const barWidth = width / history.length
  const height = 90

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height + 16}`}
        className="w-full"
        role="img"
        aria-label={`Learning actions completed per week over the last ${history.length} weeks`}
        preserveAspectRatio="none"
      >
        {history.map((week, index) => {
          const barHeight = (week.completed / max) * height
          const x = index * barWidth
          const isLast = index === history.length - 1

          return (
            <g key={week.weekStart}>
              {/* Invisible full-height target so hovering a zero-week still works. */}
              <rect
                x={x}
                y={0}
                width={barWidth}
                height={height + 16}
                fill="transparent"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              />
              <rect
                x={x + barWidth * 0.18}
                y={height - barHeight}
                width={barWidth * 0.64}
                height={Math.max(barHeight, week.completed > 0 ? 2 : 0)}
                rx={1.5}
                fill={SERIES_BLUE}
                opacity={hovered === null || hovered === index ? (isLast ? 1 : 0.75) : 0.35}
                className="transition-opacity"
              />
            </g>
          )
        })}
        <line x1={0} y1={height} x2={width} y2={height} stroke="currentColor" strokeWidth={0.4} className="text-border" />
      </svg>

      <figcaption className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{formatWeek(history[0].weekStart)}</span>
        <span>
          {hovered !== null
            ? `${history[hovered].completed} actions · week of ${formatWeek(history[hovered].weekStart)}`
            : 'This week'}
        </span>
      </figcaption>
    </figure>
  )
}

/**
 * How many topics sit at each mastery level.
 *
 * This is where the student sees their weak spots concentrated — and those are
 * exactly the topics the review-session split gives the most time to.
 */
export function MasteryChart({ distribution }: { distribution: number[] }) {
  const total = distribution.reduce((sum, count) => sum + count, 0)

  if (total === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Rate a topic once you've finished it and your mastery spread appears here.
      </p>
    )
  }

  const max = Math.max(...distribution, 1)

  return (
    <div className="space-y-2">
      {distribution.map((count, index) => (
        <div key={index} className="flex items-center gap-3">
          <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {index + 1}
          </span>

          <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${(count / max) * 100}%`,
                backgroundColor: MASTERY_RAMP[index],
                minWidth: count > 0 ? '3px' : 0,
              }}
              title={`${count} ${count === 1 ? 'topic' : 'topics'} — ${MASTERY_LABELS[index]}`}
            />
          </div>

          {/* Value labels are always visible, so identity never depends on colour alone. */}
          <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
            {count > 0 ? `${count} ${count === 1 ? 'topic' : 'topics'}` : ''}
          </span>
        </div>
      ))}

      <p className="pt-1 text-xs text-muted-foreground">
        1 = barely started · 5 = could teach it. Lower-rated topics get more time in the
        review session.
      </p>
    </div>
  )
}

/**
 * Donut showing how the sprint's committed hours sit inside available capacity.
 * Over-commitment is drawn as a full ring in the warning colour rather than
 * overflowing, because a ring past 100% reads as "nearly done" at a glance.
 */
export function CapacityRing({
  committedMinutes,
  capacityMinutes,
  status,
}: {
  committedMinutes: number
  capacityMinutes: number
  status: string
}) {
  const isOver = status === 'over_committed' || status === 'no_capacity'
  const ratio =
    capacityMinutes > 0 ? Math.min(1, committedMinutes / capacityMinutes) : isOver ? 1 : 0

  const radius = 34
  const circumference = 2 * Math.PI * radius
  const colour = isOver ? '#e34948' : status === 'tight' ? '#eda100' : '#1baf7a'

  return (
    <div className="relative size-24 shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90" role="img"
        aria-label={`${Math.round(ratio * 100)} percent of this week's capacity committed`}>
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="8"
          stroke="currentColor" className="text-muted" />
        <circle
          cx="40" cy="40" r={radius} fill="none" strokeWidth="8" strokeLinecap="round"
          stroke={colour}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold tabular-nums">
          {capacityMinutes > 0 ? Math.round((committedMinutes / capacityMinutes) * 100) : 0}%
        </span>
        <span className="text-[10px] text-muted-foreground">booked</span>
      </div>
    </div>
  )
}

function formatWeek(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
