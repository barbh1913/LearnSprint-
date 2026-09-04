import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { api } from '../api/client'
import type { Board, Course, Grades, Velocity } from '../types'
import { STATUS_LABELS } from '../types'
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  ProgressBar,
  Spinner,
} from '../components/ui/primitives'

export function DashboardPage() {
  const [board, setBoard] = useState<Board | null>(null)
  const [velocity, setVelocity] = useState<Velocity | null>(null)
  const [grades, setGrades] = useState<Grades | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getBoard(), api.getVelocity(), api.getGrades(), api.listCourses()])
      .then(([loadedBoard, loadedVelocity, loadedGrades, loadedCourses]) => {
        setBoard(loadedBoard)
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
    .slice(0, 3)

  const totalActions = board?.cards.reduce((sum, card) => sum + card.actions.length, 0) ?? 0
  const doneActions = board?.cards.reduce((sum, card) => sum + card.actionsDone, 0) ?? 0

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Where you stand across every course." />

      {error && <ErrorNote message={error} />}

      {board && board.totalTopics === 0 ? (
        <EmptyState
          title="Nothing planned yet"
          description="Add your first course to start building a study plan."
          action={
            <Link to="/courses" className="text-sm font-medium text-primary hover:underline">
              Add a course
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Topics done"
              value={`${board?.doneTopics ?? 0} / ${board?.totalTopics ?? 0}`}
            />
            <Stat
              label="This week"
              value={`${velocity?.actionsCompletedThisWeek ?? 0} actions`}
              trend={velocity?.trend}
            />
            <Stat label="Weekly average" value={`${velocity?.weeklyAverage ?? 0} actions`} />
            <Stat
              label="Weighted average"
              value={grades?.overall.average != null ? String(grades.overall.average) : '—'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h2 className="mb-3 font-medium">Overall progress</h2>
              <div className="mb-2 flex justify-between text-sm text-muted-foreground">
                <span>{doneActions} of {totalActions} learning actions</span>
                <span>
                  {totalActions > 0 ? Math.round((doneActions / totalActions) * 100) : 0}%
                </span>
              </div>
              <ProgressBar value={doneActions} max={totalActions} />

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {board &&
                  (Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((status) => (
                    <div key={status} className="rounded-lg bg-muted p-3 text-center">
                      <p className="text-lg font-semibold">
                        {board.cards.filter((card) => card.status === status).length}
                      </p>
                      <p className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</p>
                    </div>
                  ))}
              </div>
            </Card>

            <Card>
              <h2 className="mb-3 font-medium">Next exams</h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exam dates set yet.</p>
              ) : (
                <ul className="space-y-3">
                  {upcoming.map((course) => (
                    <li key={course.id}>
                      <Link
                        to={`/courses/${course.id}`}
                        className="text-sm font-medium hover:text-primary hover:underline"
                      >
                        {course.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {new Date(course.examDate!).toLocaleDateString()} ·{' '}
                        {daysUntil(course.examDate!)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {velocity?.averageMastery != null && (
                <div className="mt-5 border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground">Average mastery</p>
                  <p className="text-lg font-semibold">{velocity.averageMastery} / 5</p>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  )
}

function Stat({
  label,
  value,
  trend,
}: {
  label: string
  value: string
  trend?: Velocity['trend']
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-xl font-semibold">{value}</p>
        {trend && (
          <TrendIcon
            className={
              trend === 'up'
                ? 'size-4 text-emerald-600'
                : trend === 'down'
                  ? 'size-4 text-red-600'
                  : 'size-4 text-muted-foreground'
            }
            aria-label={`Trend: ${trend}`}
          />
        )}
      </div>
    </div>
  )
}

function daysUntil(isoDate: string): string {
  const days = Math.ceil((new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0) return 'Passed'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}
