import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { Course, ExamType } from '../types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui/primitives'

const EXAM_TYPES: { value: ExamType; label: string }[] = [
  { value: 'closed', label: 'Closed book' },
  { value: 'open_material', label: 'Open material' },
  { value: 'formula_sheet', label: 'Formula sheet' },
]

export function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)

  useEffect(() => {
    loadCourses()
  }, [])

  async function loadCourses() {
    setIsLoading(true)
    try {
      setCourses(await api.listCourses())
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load courses')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleDelete(course: Course) {
    if (!confirm(`Delete "${course.name}" and all of its topics?`)) return

    await api.deleteCourse(course.id)
    loadCourses()
  }

  if (isLoading) return <Spinner label="Loading courses" />

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="Every course you're studying this degree."
        action={
          <Button variant="primary" onClick={() => setIsFormOpen((open) => !open)}>
            <Plus className="size-4" aria-hidden />
            New course
          </Button>
        }
      />

      {error && <ErrorNote message={error} />}

      {isFormOpen && (
        <CourseForm
          onCreated={() => {
            setIsFormOpen(false)
            loadCourses()
          }}
          onCancel={() => setIsFormOpen(false)}
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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="flex flex-col justify-between">
              <div>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Link
                    to={`/courses/${course.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {course.name}
                  </Link>
                  <button
                    onClick={() => handleDelete(course)}
                    aria-label={`Delete ${course.name}`}
                    className="text-muted-foreground transition-colors hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
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
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                {course.examDate
                  ? `Exam ${new Date(course.examDate).toLocaleDateString()}`
                  : 'No exam date set'}
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function CourseForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [year, setYear] = useState(1)
  const [semester, setSemester] = useState('A')
  const [credits, setCredits] = useState(3)
  const [examDate, setExamDate] = useState('')
  const [examType, setExamType] = useState<ExamType>('closed')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setError('')

    try {
      await api.createCourse({
        name,
        year,
        semester,
        credits,
        examDate: examDate || null,
        examType,
      })
      onCreated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the course')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="mb-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" aria-hidden />
          <h2 className="font-medium">New course</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Data Structures"
              required
            />
          </Field>

          <Field label="Credit points">
            <Input
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={credits}
              onChange={(event) => setCredits(Number(event.target.value))}
              required
            />
          </Field>

          <Field label="Year">
            <Select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {[1, 2, 3, 4].map((option) => (
                <option key={option} value={option}>
                  Year {option}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Semester">
            <Select value={semester} onChange={(event) => setSemester(event.target.value)}>
              {['A', 'B', 'Summer'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Exam date">
            <Input
              type="date"
              value={examDate}
              onChange={(event) => setExamDate(event.target.value)}
            />
          </Field>

          <Field label="Exam type">
            <Select
              value={examType}
              onChange={(event) => setExamType(event.target.value as ExamType)}
            >
              {EXAM_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {error && <ErrorNote message={error} />}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={isSaving}>
            {isSaving ? 'Saving' : 'Create course'}
          </Button>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
