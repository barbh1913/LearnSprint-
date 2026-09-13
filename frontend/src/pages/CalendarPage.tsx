import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Zap } from 'lucide-react'
import { api } from '../api/client'
import type { Board, Course, ScheduleBlock } from '../types'
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
import { MonthGrid } from '../components/calendar/MonthGrid'
import { GoogleCalendarControls } from '../components/calendar/GoogleCalendarControls'
import {
  addDays,
  addMonths,
  formatMonth,
  formatWeekRange,
  hourRange,
  initialCursorFor,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../components/calendar/calendarMath'

type CalendarView = 'week' | 'month'

/** How one course fared in the plan - what the warning banners are built from. */
interface CourseOutcome {
  courseId: string
  courseName: string
  feasible: boolean
  isEmergencyMode: boolean
  reason: string | null
  shortfallMinutes: number
}

/** The plan as shown: every course, or one course's slice of the same plan. */
interface PlanView {
  blocks: ScheduleBlock[]
  totalAvailableMinutes: number
  totalNeededMinutes: number
  courses: CourseOutcome[]
}

/**
 * The Calendar (FR6.1): the generated schedule on a weekly time grid, with a
 * month overview. All courses by default - one combined plan (FR3.1) - or
 * filtered to a single course, which is a slice of that same plan.
 *
 * Purely a view of what the backend already computed - no scheduling logic
 * here. The schedule is recomputed on each load rather than stored (ADR 0005).
 * The board is loaded alongside it only so that clicking an event can open the
 * same topic detail dialog the board uses.
 */
export function CalendarPage() {
  const [courses, setCourses] = useState<Course[]>([])
  // '' means every course - the default.
  const [courseId, setCourseId] = useState('')
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [view, setView] = useState<CalendarView>('week')
  // The day in focus: the week view shows its week, the month view its month.
  const [cursor, setCursor] = useState<Date | null>(null)
  const [selected, setSelected] = useState<{ topicId: string; actionId: string | null } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)

  const today = useMemo(() => new Date(), [])
  const showingAll = courseId === ''

  const loadPlan = useCallback(async () => {
    try {
      if (courseId === '') {
        const [loaded, loadedBoard] = await Promise.all([api.getStudentPlan(), api.getBoard()])
        setPlan({
          blocks: loaded.blocks,
          totalAvailableMinutes: loaded.totalAvailableMinutes,
          totalNeededMinutes: loaded.totalNeededMinutes,
          courses: loaded.courses.map((course) => ({
            courseId: course.courseId,
            courseName: course.courseName,
            feasible: course.feasible,
            isEmergencyMode: course.isEmergencyMode,
            reason: course.reason ?? null,
            shortfallMinutes: course.shortfallMinutes ?? 0,
          })),
        })
        setBoard(loadedBoard)
      } else {
        const [loaded, loadedBoard] = await Promise.all([
          api.getSchedule(courseId),
          api.getBoard(courseId),
        ])
        setPlan({
          blocks: loaded.blocks,
          totalAvailableMinutes: loaded.totalAvailableMinutes,
          totalNeededMinutes: loaded.totalNeededMinutes,
          courses: [
            {
              courseId,
              courseName: loaded.blocks[0]?.courseName ?? '',
              feasible: loaded.feasible,
              isEmergencyMode: loaded.isEmergencyMode,
              reason: loaded.reason ?? null,
              shortfallMinutes: loaded.shortfallMinutes ?? 0,
            },
          ],
        })
        setBoard(loadedBoard)
      }
      setError('')
    } catch (caught) {
      setPlan(null)
      setBoard(null)
      setError(caught instanceof Error ? caught.message : 'Could not load the plan')
    }
  }, [courseId])

  useEffect(() => {
    api
      .listCourses()
      .then(setCourses)
      .catch((caught) => setError(caught.message))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    setCursor(null)
    loadPlan()
  }, [loadPlan])

  // Land where the plan is, but only once per filter - a reload after ticking
  // an action must not yank the user back.
  useEffect(() => {
    if (plan && cursor === null) {
      setCursor(initialCursorFor(plan.blocks, today))
    }
  }, [plan, cursor, today])

  const cardsByTopic = useMemo(
    () => new Map((board?.cards ?? []).map((card) => [card.topicId, card])),
    [board],
  )
  const range = useMemo(() => hourRange(plan?.blocks ?? []), [plan])

  async function handleExport() {
    setIsExporting(true)
    try {
      if (showingAll) {
        await api.downloadStudentPlanIcs()
      } else {
        const course = courses.find((item) => item.id === courseId)
        if (course) await api.downloadScheduleIcs(course.id, course.name)
      }
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

  function shiftCursor(direction: -1 | 1) {
    if (!cursor) return
    setCursor(view === 'week' ? addDays(cursor, 7 * direction) : addMonths(cursor, direction))
  }

  function showDayInWeek(day: Date) {
    setCursor(day)
    setView('week')
  }

  if (isLoading) return <Spinner label="Loading calendar" />

  const hasPlan = Boolean(plan && plan.blocks.length > 0)
  const hasCourses = Boolean(plan && plan.courses.length > 0)
  // A course whose plan is fine needs no banner; the others are named so the
  // student knows which exam is the problem.
  const troubled = (plan?.courses ?? []).filter((course) => !course.feasible || course.isEmergencyMode)

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Your study sessions, week by week - planned around your blocked hours, the exam dates, and how well you know each topic."
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
              aria-label="Filter by course"
            >
              <option value="">All courses</option>
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

      {troubled.map((course) =>
        !course.feasible ? (
          <Card
            key={course.courseId}
            className="mb-6 border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
          >
            <div className="flex gap-3">
              <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {showingAll ? `${course.courseName}: this plan doesn't fit` : "This plan doesn't fit"}
                </p>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{course.reason}</p>
                <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
                  You need about {formatMinutes(course.shortfallMinutes)} more free time
                  {showingAll ? ' before this exam' : ''}. Try freeing up some blocked hours in
                  your profile.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <Card
            key={course.courseId}
            className="mb-6 border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
          >
            <div className="flex gap-3">
              <Zap className="size-5 shrink-0 text-red-600" aria-hidden />
              <div>
                <p className="font-medium text-red-900 dark:text-red-200">
                  {showingAll ? `${course.courseName}: emergency mode` : 'Emergency mode'}
                </p>
                <p className="mt-1 text-sm text-red-800 dark:text-red-300">
                  There isn't time for the full read-summarize-quiz cycle, so the plan is one
                  condensed review session with equal time per topic.
                </p>
              </div>
            </div>
          </Card>
        ),
      )}

      {plan && hasCourses && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat
            label={showingAll ? 'Free time until your last exam' : 'Free time before exam'}
            value={formatMinutes(plan.totalAvailableMinutes)}
          />
          <Stat label="Study time planned" value={formatMinutes(plan.totalNeededMinutes)} />
          <Stat label="Sessions" value={String(plan.blocks.length)} />
        </div>
      )}

      <GoogleCalendarControls courseId={courseId} canSync={hasPlan} />

      {plan && !hasCourses ? (
        <EmptyState
          title="No study plan yet"
          description="Set an exam date on a course and its sessions will appear here, planned around your blocked hours."
        />
      ) : plan && !hasPlan && troubled.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description={
            showingAll
              ? 'Add topics to your courses, then the plan will fill in around your blocked hours.'
              : 'Add topics to this course, then the plan will fill in around your blocked hours.'
          }
        />
      ) : (
        hasPlan &&
        plan &&
        cursor && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => shiftCursor(-1)}
                  aria-label={`Previous ${view}`}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button size="sm" onClick={() => setCursor(startOfDay(today))}>
                  Today
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => shiftCursor(1)}
                  aria-label={`Next ${view}`}
                >
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
                <span className="ml-2 text-sm font-medium">
                  {view === 'week' ? formatWeekRange(startOfWeek(cursor)) : formatMonth(cursor)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden items-center gap-2 sm:flex">
                  <Badge tone="success">Action</Badge>
                  <Badge tone="accent">Review</Badge>
                  <Badge tone="warning">Study aids</Badge>
                </div>
                <div className="flex items-center gap-1" role="group" aria-label="Calendar view">
                  {(['week', 'month'] as const).map((option) => (
                    <Button
                      key={option}
                      size="sm"
                      variant={view === option ? 'primary' : 'ghost'}
                      aria-pressed={view === option}
                      onClick={() => setView(option)}
                    >
                      {option === 'week' ? 'Week' : 'Month'}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {view === 'week' ? (
              <WeekGrid
                weekStart={startOfWeek(cursor)}
                blocks={plan.blocks}
                range={range}
                today={today}
                showCourse={showingAll}
                onSelectBlock={handleSelectBlock}
              />
            ) : (
              <MonthGrid
                month={startOfMonth(cursor)}
                blocks={plan.blocks}
                today={today}
                showCourse={showingAll}
                onSelectDay={showDayInWeek}
              />
            )}
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
