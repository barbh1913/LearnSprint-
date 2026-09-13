import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { AccountSettings } from '../components/AccountSettings'
import type { BlockedSlot, UserConstraints } from '../types'
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui/primitives'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Time constraints (FR1.1) - these are what the scheduler plans around. */
export function ProfilePage() {
  const [constraints, setConstraints] = useState<UserConstraints | null>(null)
  const [error, setError] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    api
      .getConstraints()
      .then(setConstraints)
      .catch((caught) => setError(caught.message))
      .finally(() => setIsLoading(false))
  }, [])

  async function handleSave() {
    if (!constraints) return

    setIsSaving(true)
    setSavedNote('')
    try {
      setConstraints(await api.saveConstraints(constraints))
      setSavedNote('Saved. Your study plan will use these next time it is generated.')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save')
    } finally {
      setIsSaving(false)
    }
  }

  function addSlot() {
    if (!constraints) return
    setConstraints({
      ...constraints,
      blockedSlots: [
        ...constraints.blockedSlots,
        { day: 0, startTime: '09:00', endTime: '17:00' },
      ],
    })
  }

  function updateSlot(index: number, changes: Partial<BlockedSlot>) {
    if (!constraints) return
    setConstraints({
      ...constraints,
      blockedSlots: constraints.blockedSlots.map((slot, position) =>
        position === index ? { ...slot, ...changes } : slot,
      ),
    })
  }

  function removeSlot(index: number) {
    if (!constraints) return
    setConstraints({
      ...constraints,
      blockedSlots: constraints.blockedSlots.filter((_, position) => position !== index),
    })
  }

  if (isLoading) return <Spinner label="Loading profile" />
  if (!constraints) return <ErrorNote message={error || 'Could not load your profile'} />

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Tell LearnSprint when you can't study, so the plan works around it."
      />

      {error && <ErrorNote message={error} />}

      <AccountSettings />

      <Card className="mb-4">
        <h2 className="mb-3 font-medium">When do you study best?</h2>
        <Field label="Preferred study time">
          <Select
            value={constraints.timePreference}
            onChange={(event) =>
              setConstraints({
                ...constraints,
                timePreference: event.target.value as UserConstraints['timePreference'],
              })
            }
            className="max-w-xs"
          >
            <option value="morning">Mornings (06:00 – 14:00)</option>
            <option value="evening">Evenings (15:00 – 23:00)</option>
          </Select>
        </Field>
      </Card>

      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-medium">Blocked hours</h2>
            <p className="text-sm text-muted-foreground">
              Work, lectures, anything you can't move. Nothing gets scheduled here.
            </p>
          </div>
          <Button onClick={addSlot}>
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        </div>

        {constraints.blockedSlots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No blocked hours yet. Add your work shifts or lectures.
          </p>
        ) : (
          <div className="space-y-2">
            {constraints.blockedSlots.map((slot, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  value={slot.day}
                  onChange={(event) => updateSlot(index, { day: Number(event.target.value) })}
                  className="w-36"
                  aria-label="Day of week"
                >
                  {DAY_NAMES.map((name, dayIndex) => (
                    <option key={name} value={dayIndex}>
                      {name}
                    </option>
                  ))}
                </Select>

                <Input
                  type="time"
                  value={slot.startTime}
                  onChange={(event) => updateSlot(index, { startTime: event.target.value })}
                  className="w-32"
                  aria-label="Start time"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={slot.endTime}
                  onChange={(event) => updateSlot(index, { endTime: event.target.value })}
                  className="w-32"
                  aria-label="End time"
                />

                <button
                  onClick={() => removeSlot(index)}
                  aria-label={`Remove ${DAY_NAMES[slot.day]} block`}
                  className="text-muted-foreground transition-colors hover:text-red-600"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving' : 'Save changes'}
        </Button>
        {savedNote && <p className="text-sm text-muted-foreground">{savedNote}</p>}
      </div>
    </>
  )
}
