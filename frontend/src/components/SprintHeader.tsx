// The centrepiece of the board: this week's commitment measured against the
// hours actually free. Over-commitment shows up here before the week starts,
// which is the whole point of planning studies as a sprint.

import { AlertTriangle, CalendarRange, CheckCircle2 } from 'lucide-react'
import type { Sprint } from '../types'
import { Card } from './ui/primitives'
import { cn } from '../lib/utils'

const STATUS_COPY: Record<Sprint['status'], { title: string; detail: string }> = {
  empty: {
    title: 'Nothing planned this week',
    detail: 'Drag topics from Backlog into To do to commit to them for this sprint.',
  },
  healthy: {
    title: 'This week fits',
    detail: 'Your commitment sits comfortably inside the hours you have free.',
  },
  tight: {
    title: 'This week is tight',
    detail: 'It fits, but with almost no slack. Consider moving a topic back to Backlog.',
  },
  over_committed: {
    title: 'You have committed to more than fits',
    detail: 'Move topics back to Backlog, or free up some blocked hours in your profile.',
  },
  no_capacity: {
    title: 'No free hours this week',
    detail: 'Every study hour is blocked. Open some up in your profile to plan a sprint.',
  },
}

export function SprintHeader({ sprint }: { sprint: Sprint }) {
  const copy = STATUS_COPY[sprint.status]
  const isProblem = sprint.status === 'over_committed' || sprint.status === 'no_capacity'
  const percent =
    sprint.capacityMinutes > 0
      ? Math.min(100, Math.round((sprint.committedMinutes / sprint.capacityMinutes) * 100))
      : 0

  return (
    <Card
      className={cn(
        'mb-5',
        isProblem && 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950',
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          {isProblem ? (
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
          ) : sprint.status === 'empty' ? (
            <CalendarRange className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
          )}
          <div>
            <p className="font-medium">{copy.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{copy.detail}</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {sprint.daysRemaining === 0
            ? 'Last day of the sprint'
            : `${sprint.daysRemaining} day${sprint.daysRemaining === 1 ? '' : 's'} left`}
        </p>
      </div>

      <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
        <span>
          <span className="font-medium">{formatHours(sprint.committedMinutes)}</span>{' '}
          <span className="text-muted-foreground">
            committed across {sprint.topicCount} {sprint.topicCount === 1 ? 'topic' : 'topics'}
          </span>
        </span>
        <span className="text-muted-foreground">
          {formatHours(sprint.capacityMinutes)} free this week
        </span>
      </div>

      {/* The bar fills toward capacity; over-commitment turns it amber. */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            sprint.status === 'over_committed' || sprint.status === 'no_capacity'
              ? 'bg-amber-500'
              : sprint.status === 'tight'
                ? 'bg-yellow-500'
                : 'bg-primary',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>
          {sprint.remainingCapacityMinutes >= 0
            ? `${formatHours(sprint.remainingCapacityMinutes)} still free`
            : `${formatHours(Math.abs(sprint.remainingCapacityMinutes))} over capacity`}
        </span>
        {sprint.completedMinutes > 0 && (
          <span>{formatHours(sprint.completedMinutes)} already done</span>
        )}
        {sprint.backlogCount > 0 && <span>{sprint.backlogCount} waiting in backlog</span>}
      </div>
    </Card>
  )
}

function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
