import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Grades } from '../types'
import {
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Spinner,
} from '../components/ui/primitives'

/** Global view across courses (FR1.4) with the weighted average (FR1.3). */
export function GradesPage() {
  const [grades, setGrades] = useState<Grades | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setGrades(await api.getGrades())
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load grades')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleGradeChange(courseId: string, raw: string) {
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (Number.isNaN(value) || value < 0 || value > 100)) return

    await api.setGrade(courseId, value)
    load()
  }

  if (isLoading) return <Spinner label="Loading grades" />
  if (!grades) return <ErrorNote message={error || 'Could not load grades'} />

  return (
    <>
      <PageHeader
        title="Grades"
        subtitle="Averages are weighted by credit points, so heavier courses count for more."
      />

      {error && <ErrorNote message={error} />}

      {grades.courses.length === 0 ? (
        <EmptyState
          title="No courses yet"
          description="Once you add courses and enter their final grades, your weighted average shows up here."
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border-2 border-primary/30 bg-card p-4">
              <p className="text-xs text-muted-foreground">Overall average</p>
              <p className="mt-1 text-2xl font-semibold">{grades.overall.average ?? '—'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {grades.overall.gradedCourseCount} graded · {grades.overall.totalCredits} credits
              </p>
            </div>

            {grades.perSemester
              .filter((semester) => semester.average != null)
              .map((semester) => (
                <div key={semester.label} className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">{semester.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{semester.average}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {semester.gradedCourseCount} graded · {semester.totalCredits} credits
                  </p>
                </div>
              ))}
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Course</th>
                  <th className="px-5 py-3 font-medium">Year</th>
                  <th className="px-5 py-3 font-medium">Semester</th>
                  <th className="px-5 py-3 font-medium">Credits</th>
                  <th className="px-5 py-3 font-medium">Final grade</th>
                </tr>
              </thead>
              <tbody>
                {grades.courses.map((course) => (
                  <tr key={course.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-medium">{course.name}</td>
                    <td className="px-5 py-3 text-muted-foreground">{course.year}</td>
                    <td className="px-5 py-3 text-muted-foreground">{course.semester}</td>
                    <td className="px-5 py-3 text-muted-foreground">{course.credits}</td>
                    <td className="px-5 py-3">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={course.finalGrade ?? ''}
                        placeholder="—"
                        aria-label={`Final grade for ${course.name}`}
                        onBlur={(event) => handleGradeChange(course.id, event.target.value)}
                        className="w-24"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  )
}
