import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Zap } from 'lucide-react'
import { api } from '../api/client'
import type { Board, Course, Schedule, ScheduleBlock } from '../types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui/primitives'
import { TopicDetailDialog } from '../components/TopicDetailDialog'
import { WeekGrid } from '../components/calendar/WeekGrid'
import {
  addDays,
  formatWeekRange,
  hourRange,
  initialWeekFor,
  startOfWeek,
} from '../components/calendar/calendarMath'

/**
 * The Calendar (FR6.1): the generated schedule on a weekly time grid.
 *
 * Purely a view of what the backend already computed - no scheduling logic
 * here. The schedule is recomputed on each load rather than stored (ADR 0005).
 * The board is loaded alongside it only so that clicking an event can open the
 * same topic detail dialog the board uses.
 */
export function CalendarPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [courseId, setCourseId] = useState('')
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [weekStart, setWeekStart] = useState<Date | null>(null)
  const [selected, setSelected] = useState<{ topicId: string; actionId: string | null } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)

  const today = useMemo(() => new Date(), [])

  const loadPlan = useCallback(async () => {
    if (!courseId) {
      setSchedule(null)
      setBoard(null)
      return
    }
    try {
      const [loadedSchedule, loadedBoard] = await Promise.all([
        api.getSchedule(courseId),
        api.getBoard(courseId),
      ])
      setSchedule(loadedSchedule)
      setBoard(loadedBoard)
      setError('')
    } catch (caught) {
      setSchedule(null)
      setBoard(null)
      setError(caught instanceof Error ? caught.message : 'Could not load the plan')
    }
  }, [courseId])

  useEffect(() => {
    api
      .listCourses()
      .then((loaded) => {
        setCourses(loaded)
        // Default to the first course that actually has an exam to plan for.
        const schedulable = loaded.find((course) => course.examDate)
        if (schedulable) setCourseId(schedulable.id)
      })
      .catch((caught) => setError(caught.message))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    setWeekStart(null)
    loadPlan()
  }, [loadPlan])

  // Land on the first week that has anything in it, but only once per course -
  // a reload after ticking an action must not yank the user back.
  useEffect(() => {
    if (schedule && weekStart === null) {
      setWeekStart(initialWeekFor(schedule.blocks, today))
    }
  }, [schedule, weekStart, today])

  const cardsByTopic = useMemo(
    () => new Map((board?.cards ?? []).map((card) => [card.topicId, card])),
    [board],
  )
  const range = useMemo(() => hourRange(schedule?.blocks ?? []), [schedule])

  async function handleExport() {
    const course = courses.find((item) => item.id === courseId)
    if (!course) return

    setIsExporting(true)
    try {
      await api.downloadScheduleIcs(course.id, course.name)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not export the plan')
    } finally {
      setIsExporting(false)
    }
  }

  function handleSelectBlock(block: ScheduleBlock) {
    if (block.topicId && cardsByTopic.has(block.topicId)) {
      setSelected({ topicId: block.topicId, actionId: block.actionId })
    }
  }

  if (isLoading) return <Spinner label="Loading calendar" />

  const hasPlan = Boolean(schedule?.feasible && schedule.blocks.length > 0)

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Your study sessions, week by week - planned around your blocked hours, the exam date, and how well you know each topic."
        action={
          <div className="flex items-center gap-2">
            {hasPlan && (
              <Button onClick={handleExport} disabled={isExporting}>
                <Download className="size-4" aria-hidden />
                {isExporting ? 'Preparing' : 'Download .ics'}
              </Button>
            )}
            <Select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className="w-52"
              aria-label="Choose a course"
            >
              <option value="">Choose a course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {error && <ErrorNote message={error} />}

      {schedule && !schedule.feasible && (
        <Card className="mb-6 border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
          <div className="flex gap-3">
            <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                This plan doesn't fit
              </p>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{schedule.reason}</p>
              <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
                You need about {formatMinutes(schedule.shortfallMinutes ?? 0)} more free time.
                Try freeing up some blocked hours in your profile.
              </p>
            </div>
          </div>
        </Card>
      )}

      {schedule?.isEmergencyMode && (
        <Card className="mb-6 border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <div className="flex gap-3">
            <Zap className="size-5 shrink-0 text-red-600" aria-hidden />
            <div>
              <p className="font-medium text-red-900 dark:text-red-200">Emergency mode</p>
              <p className="mt-1 text-sm text-red-800 dark:text-red-300">
                There isn't time for the full read-summarize-quiz cycle, so the plan is one
                condensed review session with equal time per topic.
              </p>
            </div>
          </div>
        </Card>
      )}

      {schedule?.feasible && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Free time before exam" value={formatMinutes(schedule.totalAvailableMinutes)} />
          <Stat label="Study time planned" value={formatMinutes(schedule.totalNeededMinutes)} />
          <Stat label="Sessions" value={String(schedule.blocks.length)} />
        </div>
      )}

      {!courseId ? (
        <EmptyState
          title="Pick a course"
          description="Choose a course with an exam date and its study plan will appear here."
        />
      ) : !hasPlan && !error && schedule?.feasible ? (
        <EmptyState
          title="Nothing scheduled"
          description="Add topics to this course, then the plan will fill in around your blocked hours."
        />
      ) : (
        hasPlan &&
        schedule &&
        weekStart && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setWeekStart(addDays(weekStart, -7))}
                  aria-label="Previous week"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button size="sm" onClick={() => setWeekStart(startOfWeek(today))}>
                  Today
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setWeekStart(addDays(weekStart, 7))}
                  aria-label="Next week"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
                <span className="ml-2 text-sm font-medium">{formatWeekRange(weekStart)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="success">Action</Badge>
                <Badge tone="accent">Review</Badge>
                <Badge tone="warning">Study aids</Badge>
              </div>
            </div>

            <WeekGrid
              weekStart={weekStart}
              blocks={schedule.blocks}
              range={range}
              today={today}
              onSelectBlock={handleSelectBlock}
            />
          </div>
        )
      )}

      <TopicDetailDialog
        card={selected ? (cardsByTopic.get(selected.topicId) ?? null) : null}
        highlightActionId={selected?.actionId ?? null}
        onClose={() => setSelected(null)}
        onChanged={loadPlan}
      />
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  )
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
