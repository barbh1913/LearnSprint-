import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { Course } from '../types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from '../components/ui/primitives'
import { CourseForm } from '../components/CourseForm'

export function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editing, setEditing] = useState<Course | null>(null)

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
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setIsFormOpen((open) => !open)
            }}
          >
            <Plus className="size-4" aria-hidden />
            New course
          </Button>
        }
      />

      {error && <ErrorNote message={error} />}

      {(isFormOpen || editing) && (
        <CourseForm
          course={editing ?? undefined}
          onSaved={() => {
            setIsFormOpen(false)
            setEditing(null)
            loadCourses()
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
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => {
                        setIsFormOpen(false)
                        setEditing(course)
                      }}
                      aria-label={`Edit ${course.name}`}
                      className="text-muted-foreground transition-colors hover:text-primary"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(course)}
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
