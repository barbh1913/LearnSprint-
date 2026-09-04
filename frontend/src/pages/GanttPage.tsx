import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarPlus, Zap } from 'lucide-react'
import { api } from '../api/client'
import type { Course, Schedule, ScheduleBlock } from '../types'
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
import { cn } from '../lib/utils'

/**
 * Weekly timeline of the generated schedule (FR6.1).
 *
 * Purely a view of what the backend already computed - no scheduling logic
 * here. The schedule is recomputed on each load rather than stored (ADR 0005).
 */
export function GanttPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [courseId, setCourseId] = useState('')
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)

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
    if (!courseId) {
      setSchedule(null)
      return
    }

    setError('')
    api
      .getSchedule(courseId)
      .then(setSchedule)
      .catch((caught) => {
        setSchedule(null)
        setError(caught.message)
      })
  }, [courseId])

  if (isLoading) return <Spinner label="Loading schedule" />

  const byDay = groupByDay(schedule?.blocks ?? [])

  return (
    <>
      <PageHeader
        title="Study plan"
        subtitle="Generated from your blocked hours, the exam date, and how well you know each topic."
        action={
          <div className="flex items-center gap-2">
            {schedule?.feasible && schedule.blocks.length > 0 && (
              <Button onClick={handleExport} disabled={isExporting}>
                <CalendarPlus className="size-4" aria-hidden />
                {isExporting ? 'Preparing' : 'Add to calendar'}
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
      ) : byDay.length === 0 && !error ? (
        <EmptyState
          title="Nothing scheduled"
          description="Add topics to this course, then the plan will fill in around your blocked hours."
        />
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, blocks]) => (
            <Card key={day}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-medium">{day}</h2>
                <span className="text-xs text-muted-foreground">
                  {formatMinutes(blocks.reduce((sum, block) => sum + block.durationMinutes, 0))}
                </span>
              </div>

              <div className="space-y-2">
                {blocks.map((block, index) => (
                  <div key={index} className="flex items-stretch gap-3">
                    <div className="w-24 shrink-0 pt-0.5 text-xs text-muted-foreground">
                      {formatTime(block.start)}
                    </div>

                    <div
                      className={cn(
                        'flex-1 rounded-lg border-l-4 px-3 py-2',
                        block.blockType === 'review'
                          ? 'border-l-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                          : block.blockType === 'study_aid'
                            ? 'border-l-amber-500 bg-amber-50 dark:bg-amber-950/40'
                            : 'border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{block.label}</span>
                        <Badge>{block.durationMinutes}m</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
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

/** Group blocks under a readable day heading, keeping chronological order. */
function groupByDay(blocks: ScheduleBlock[]): [string, ScheduleBlock[]][] {
  const grouped = new Map<string, ScheduleBlock[]>()

  for (const block of blocks) {
    const day = new Date(block.start).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    })
    grouped.set(day, [...(grouped.get(day) ?? []), block])
  }

  return [...grouped.entries()]
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
