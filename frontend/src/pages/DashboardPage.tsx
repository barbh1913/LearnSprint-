import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
} from 'lucide-react'
import { api } from '../api/client'
import type { Board, Course, Grades, Sprint, Velocity } from '../types'
import { STATUS_LABELS, STATUS_ORDER } from '../types'
import { Card, EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui/primitives'
import { CapacityRing, MasteryChart, VelocityChart } from '../components/charts'
import { cn } from '../lib/utils'

export function DashboardPage() {
  const [board, setBoard] = useState<Board | null>(null)
  const [sprint, setSprint] = useState<Sprint | null>(null)
  const [velocity, setVelocity] = useState<Velocity | null>(null)
  const [grades, setGrades] = useState<Grades | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.getBoard(),
      api.getSprint(),
      api.getVelocity(),
      api.getGrades(),
      api.listCourses(),
    ])
      .then(([loadedBoard, loadedSprint, loadedVelocity, loadedGrades, loadedCourses]) => {
        setBoard(loadedBoard)
        setSprint(loadedSprint)
        setVelocity(loadedVelocity)
        setGrades(loadedGrades)
        setCourses(loadedCourses)
      })
      .catch((caught) => setError(caught.message))
      .finally(() => setIsLoading(false))
  }, [])

  if (isLoading) return <Spinner label="Loading dashboard" />

  const upcoming = courses
    .filter((course) => course.examDate)
    .sort((a, b) => (a.examDate! < b.examDate! ? -1 : 1))
    .slice(0, 4)

  const totalActions = board?.cards.reduce((sum, card) => sum + card.actions.length, 0) ?? 0
  const doneActions = board?.cards.reduce((sum, card) => sum + card.actionsDone, 0) ?? 0
  const needsReview = board?.cards.filter((card) => card.status === 'needs_review').length ?? 0

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Where this week stands, and where you stand overall."
      />

      {error && <ErrorNote message={error} />}

      {board && board.totalTopics === 0 ? (
        <EmptyState
          title="Let's set up your first course"
          description="Add a course, upload its material, and LearnSprint works out the topics and how long each takes to learn."
          action={
            <Link
              to="/courses"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <BookOpen className="size-4" aria-hidden />
              Add a course
            </Link>
          }
        />
      ) : (
        <>
          {/* This week comes first — it's the question the product exists to answer. */}
          {sprint && (
            <Card className="mb-4">
              <div className="flex flex-wrap items-center gap-6">
                <CapacityRing
                  committedMinutes={sprint.committedMinutes}
                  capacityMinutes={sprint.capacityMinutes}
                  status={sprint.status}
                />

                <div className="min-w-56 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h2 className="font-medium">This week's sprint</h2>
                    {(sprint.status === 'over_committed' || sprint.status === 'no_capacity') && (
                      <AlertTriangle className="size-4 text-amber-600" aria-hidden />
                    )}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {sprint.status === 'empty'
                      ? 'Nothing committed yet — pull topics into To do on the board.'
                      : sprint.status === 'over_committed'
                        ? `You've committed ${formatHours(Math.abs(sprint.remainingCapacityMinutes))} more than you have free.`
                        : sprint.status === 'no_capacity'
                          ? 'Every study hour this week is blocked out.'
                          : `${formatHours(sprint.committedMinutes)} committed across ${sprint.topicCount} ${sprint.topicCount === 1 ? 'topic' : 'topics'}, out of ${formatHours(sprint.capacityMinutes)} free.`}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <Figure label="Free left" value={formatHours(Math.max(0, sprint.remainingCapacityMinutes))} />
                    <Figure
                      label={sprint.daysRemaining === 1 ? 'day left' : 'days left'}
                      value={String(sprint.daysRemaining)}
                    />
                    <Figure label="In backlog" value={String(sprint.backlogCount)} />
                  </div>
                </div>

                <Link
                  to="/board"
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Plan the sprint
                </Link>
              </div>
            </Card>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Topics done" value={`${board?.doneTopics ?? 0} / ${board?.totalTopics ?? 0}`} />
            <Stat
              label="Actions this week"
              value={String(velocity?.actionsCompletedThisWeek ?? 0)}
              trend={velocity?.trend}
            />
            <Stat label="Needs review" value={String(needsReview)} tone={needsReview > 0 ? 'warn' : undefined} />
            <Stat
              label="Weighted average"
              value={grades?.overall.average != null ? String(grades.overall.average) : '—'}
            />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-medium">Study velocity</h2>
                <span className="text-xs text-muted-foreground">
                  {velocity?.weeklyAverage ?? 0} actions/week average
                </span>
              </div>
              {velocity && <VelocityChart history={velocity.history} />}
            </Card>

            <Card>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-medium">Mastery spread</h2>
                {velocity?.averageMastery != null && (
                  <span className="text-xs text-muted-foreground">
                    {velocity.averageMastery} average
                  </span>
                )}
              </div>
              {velocity && <MasteryChart distribution={velocity.masteryDistribution} />}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h2 className="mb-3 font-medium">Where your topics sit</h2>

              <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-muted">
                {STATUS_ORDER.map((status) => {
                  const count = board?.cards.filter((card) => card.status === status).length ?? 0
                  if (count === 0) return null
                  return (
                    <div
                      key={status}
                      className={cn(
                        'h-full',
                        status === 'done' && 'bg-emerald-500',
                        status === 'needs_review' && 'bg-amber-500',
                        status === 'in_progress' && 'bg-primary',
                        status === 'todo' && 'bg-primary/50',
                        status === 'backlog' && 'bg-muted-foreground/30',
                      )}
                      style={{ width: `${(count / (board?.totalTopics || 1)) * 100}%` }}
                      title={`${STATUS_LABELS[status]}: ${count}`}
                    />
                  )
                })}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {STATUS_ORDER.map((status) => (
                  <div key={status} className="rounded-lg bg-muted p-3 text-center">
                    <p className="text-lg font-semibold tabular-nums">
                      {board?.cards.filter((card) => card.status === status).length ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</p>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-sm text-muted-foreground">
                {doneActions} of {totalActions} learning actions complete overall.
              </p>
            </Card>

            <div className="space-y-4">
              <Card>
                <h2 className="mb-3 font-medium">Next exams</h2>
                {upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No exam dates set yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {upcoming.map((course) => (
                      <li key={course.id} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            to={`/courses/${course.id}`}
                            className="text-sm font-medium hover:text-primary hover:underline"
                          >
                            {course.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {new Date(course.examDate!).toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
                            daysUntilCount(course.examDate!) <= 7
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {daysUntil(course.examDate!)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Shortcuts to the two things students otherwise struggle to find. */}
              <Card>
                <h2 className="mb-3 font-medium">Quick actions</h2>
                <div className="space-y-2">
                  {courses[0] && (
                    <QuickAction
                      to={`/courses/${courses[0].id}`}
                      icon={Upload}
                      label="Upload course material"
                      detail="Up to 15 PDFs or slide decks at once"
                    />
                  )}
                  <QuickAction
                    to="/gantt"
                    icon={CalendarClock}
                    label="See your study plan"
                    detail="Weekly timeline, exportable to your calendar"
                  />
                  <QuickAction
                    to="/profile"
                    icon={Sparkles}
                    label="Enable AI analysis"
                    detail="Real study-time estimates from your material"
                  />
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function QuickAction({
  to,
  icon: Icon,
  label,
  detail,
}: {
  to: string
  icon: typeof Upload
  label: string
  detail: string
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary hover:bg-muted"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </Link>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-medium tabular-nums">{value}</span>{' '}
      <span className="text-muted-foreground">{label.toLowerCase()}</span>
    </span>
  )
}

function Stat({
  label,
  value,
  trend,
  tone,
}: {
  label: string
  value: string
  trend?: Velocity['trend']
  tone?: 'warn'
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-4',
        tone === 'warn' && 'border-amber-300 dark:border-amber-900',
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {trend && (
          <TrendIcon
            className={cn(
              'size-4',
              trend === 'up'
                ? 'text-emerald-600'
                : trend === 'down'
                  ? 'text-red-600'
                  : 'text-muted-foreground',
            )}
            aria-label={`Trend: ${trend}`}
          />
        )}
      </div>
    </div>
  )
}

function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

function daysUntilCount(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function daysUntil(isoDate: string): string {
  const days = daysUntilCount(isoDate)
  if (days < 0) return 'Passed'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `${days} days`
}
