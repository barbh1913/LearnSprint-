// Shared create/edit form for a course. Used by the courses list to add one and
// by the course page to edit it, so the field rules only exist in one place.

import { useState } from 'react'
import { api } from '../api/client'
import type { Course, ExamType } from '../types'
import { Button, Card, ErrorNote, Field, Input, Select } from './ui/primitives'

const EXAM_TYPES: { value: ExamType; label: string }[] = [
  { value: 'closed', label: 'Closed book' },
  { value: 'open_material', label: 'Open material' },
  { value: 'formula_sheet', label: 'Formula sheet' },
]

export function CourseForm({
  course,
  onSaved,
  onCancel,
}: {
  /** Omit to create a new course, pass one to edit it. */
  course?: Course
  onSaved: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(course?.name ?? '')
  const [year, setYear] = useState(course?.year ?? 1)
  const [semester, setSemester] = useState(course?.semester ?? 'A')
  const [credits, setCredits] = useState(course?.credits ?? 3)
  const [examDate, setExamDate] = useState(toDateInput(course?.examDate))
  const [examType, setExamType] = useState<ExamType>(course?.examType ?? 'closed')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const isEditing = course != null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setError('')

    const payload = { name, year, semester, credits, examDate: examDate || null, examType }

    try {
      if (isEditing) {
        await api.updateCourse(course.id, payload)
      } else {
        await api.createCourse(payload)
      }
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the course')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="mb-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h2 className="font-medium">{isEditing ? 'Edit course' : 'New course'}</h2>

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
            {isSaving ? 'Saving' : isEditing ? 'Save changes' : 'Create course'}
          </Button>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

/** The date input needs plain YYYY-MM-DD, but the API may send a full timestamp. */
function toDateInput(value?: string | null): string {
  return value ? value.slice(0, 10) : ''
}
