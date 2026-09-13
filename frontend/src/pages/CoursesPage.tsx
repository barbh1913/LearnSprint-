import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { Board, Course } from '../types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  ProgressBar,
  Select,
  Spinner,
} from '../components/ui/primitives'
import { CourseForm } from '../components/CourseForm'

const SEMESTERS = ['A', 'B', 'Summer'] as const
const SEMESTER_RANK: Record<string, number> = { A: 0, B: 1, Summer: 2 }

type CourseProgress = { done: number; total: number }

export function CoursesPage() {
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [progressByCourse, setProgressByCourse] = useState<Record<string, CourseProgress>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editing, setEditing] = useState<Course | null>(null)
  const [yearFilter, setYearFilter] = useState<number | 'all'>('all')
  const [semesterFilter, setSemesterFilter] = useState<string | 'all'>('all')
  const [defaultFilterSet, setDefaultFilterSet] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setIsLoading(true)
    try {
      const [loadedCourses, board] = await Promise.all([api.listCourses(), api.getBoard()])
      setCourses(loadedCourses)
      setProgressByCourse(summarizeProgress(board))
      setError('')

      // Only the first successful load picks a default - a later reload (after
      // adding or deleting a course) must not silently yank the filter away
      // from whatever the student has it set to.
      if (!defaultFilterSet) {
        const latest = latestYearSemester(loadedCourses)
        if (latest) {
          setYearFilter(latest.year)
          setSemesterFilter(latest.semester)
        }
        setDefaultFilterSet(true)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load courses')
    } finally {
      setIsLoading(false)
    }
  }

  const availableYears = useMemo(
    () => [...new Set(courses.map((course) => course.year))].sort((a, b) => a - b),
    [courses],
  )
  const availableSemesters = useMemo(
    () => SEMESTERS.filter((semester) => courses.some((course) => course.semester === semester)),
    [courses],
  )
  const filteredCourses = courses.filter(
    (course) =>
      (yearFilter === 'all' || course.year === yearFilter) &&
      (semesterFilter === 'all' || course.semester === semesterFilter),
  )

  function clearFilters() {
    setYearFilter('all')
    setSemesterFilter('all')
  }

  function openNewCourseForm() {
    setEditing(null)
    setIsFormOpen((open) => !open)
  }

  function openEditForm(event: React.MouseEvent, course: Course) {
    event.stopPropagation()
    setIsFormOpen(false)
    setEditing(course)
  }

  async function handleDelete(event: React.MouseEvent, course: Course) {
    event.stopPropagation()
    if (!confirm(`Delete "${course.name}" and all of its topics?`)) return

    try {
      await api.deleteCourse(course.id)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that course')
    }
  }

  if (isLoading) return <Spinner label="Loading courses" />

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="Every course you're studying this degree."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(yearFilter)}
              onChange={(event) =>
                setYearFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))
              }
              aria-label="Filter by year"
              className="w-28"
            >
              <option value="all">All years</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </Select>
            <Select
              value={semesterFilter}
              onChange={(event) => setSemesterFilter(event.target.value)}
              aria-label="Filter by semester"
              className="w-32"
            >
              <option value="all">All semesters</option>
              {availableSemesters.map((semester) => (
                <option key={semester} value={semester}>
                  Semester {semester}
                </option>
              ))}
            </Select>
            <Button variant="primary" onClick={openNewCourseForm}>
              <Plus className="size-4" aria-hidden />
              New course
            </Button>
          </div>
        }
      />

      {error && <ErrorNote message={error} />}

      {(isFormOpen || editing) && (
        <CourseForm
          course={editing ?? undefined}
          defaultYear={yearFilter === 'all' ? undefined : yearFilter}
          defaultSemester={semesterFilter === 'all' ? undefined : semesterFilter}
          onSaved={() => {
            setIsFormOpen(false)
            setEditing(null)
            load()
          }}
          onCancel={() => {
            setIsFormOpen(false)
            setEditing(null)
          }}
        />
      )}

      {courses.length === 0 && !isFormOpen ? (
        <EmptyState
          title="Start your first course"
          description="Add a course, upload its syllabus, and LearnSprint builds a study plan around your schedule."
          action={
            <Button variant="primary" onClick={() => setIsFormOpen(true)}>
              Add a course
            </Button>
          }
        />
      ) : filteredCourses.length === 0 ? (
        <EmptyState
          title="No courses here"
          description="Nothing matches this year/semester filter yet."
          action={
            <Button onClick={clearFilters}>Show all courses</Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCourses.map((course) => {
            const progress = progressByCourse[course.id]

            return (
              <Card
                key={course.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/courses/${course.id}`)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  navigate(`/courses/${course.id}`)
                }}
                className="flex cursor-pointer flex-col justify-between transition-colors hover:border-primary hover:bg-muted/40"
              >
                <div>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <span className="font-medium">{course.name}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={(event) => openEditForm(event, course)}
                        aria-label={`Edit ${course.name}`}
                        className="text-muted-foreground transition-colors hover:text-primary"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={(event) => handleDelete(event, course)}
                        aria-label={`Delete ${course.name}`}
                        className="text-muted-foreground transition-colors hover:text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge>
                      Year {course.year} · {course.semester}
                    </Badge>
                    <Badge>{course.credits} credits</Badge>
                    {course.finalGrade != null && (
                      <Badge tone="success">Grade {course.finalGrade}</Badge>
                    )}
                  </div>

                  {progress && progress.total > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <ProgressBar value={progress.done} max={progress.total} />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {progress.done}/{progress.total} topics
                      </span>
                    </div>
                  )}
                </div>

                <p className="mt-4 text-xs text-muted-foreground">
                  {course.examDate
                    ? `Exam ${new Date(course.examDate).toLocaleDateString()}`
                    : 'No exam date set'}
                </p>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

/** Topics done vs. total per course, from one global board fetch instead of
 * one request per card. */
function summarizeProgress(board: Board): Record<string, CourseProgress> {
  const summary: Record<string, CourseProgress> = {}
  for (const card of board.cards) {
    const entry = summary[card.courseId] ?? { done: 0, total: 0 }
    entry.total += 1
    if (card.status === 'done') entry.done += 1
    summary[card.courseId] = entry
  }
  return summary
}

/** The most recent (year, semester) pair that actually has a course, ranking
 * semesters in the order they run within a year: A, then B, then Summer. */
function latestYearSemester(courses: Course[]): { year: number; semester: string } | null {
  if (courses.length === 0) return null

  const rank = (course: Course) => course.year * 10 + (SEMESTER_RANK[course.semester] ?? -1)
  const latest = courses.reduce((best, course) => (rank(course) > rank(best) ? course : best))
  return { year: latest.year, semester: latest.semester }
}
