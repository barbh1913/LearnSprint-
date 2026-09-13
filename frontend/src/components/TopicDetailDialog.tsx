import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { api } from '../api/client'
import type { BoardCard, MasteryLevel } from '../types'
import { ACTION_LABELS, STATUS_LABELS } from '../types'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Badge, ErrorNote, Input } from './ui/primitives'
import { MasteryPicker } from './MasteryPicker'

/**
 * Jira/Linear-style detail view for one topic, opened from the board (FR4.1)
 * instead of navigating away from it. Edits the same fields the course page
 * does (rename, priority, actions, mastery), plus a per-action time estimate
 * that previously could only be set once at extraction time (FR2.2).
 */
export function TopicDetailDialog({
  card,
  onClose,
  onChanged,
}: {
  card: BoardCard | null
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState(card?.name ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    setName(card?.name ?? '')
    setError('')
  }, [card?.topicId, card?.name])

  if (!card) return null

  async function runMutation(action: () => Promise<unknown>) {
    try {
      await action()
      setError('')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That change could not be saved')
    }
  }

  function handleRename() {
    if (!card || !name.trim() || name === card.name) return
    runMutation(() => api.updateTopic(card.courseId, card.topicId, { name: name.trim() }))
  }

  function handleTogglePriority() {
    if (!card) return
    runMutation(() =>
      api.updateTopic(card.courseId, card.topicId, { isPriority: !card.isPriority }),
    )
  }

  function handleToggleAction(actionId: string, isDone: boolean) {
    if (!card) return
    runMutation(() => api.setActionDone(card.courseId, actionId, isDone))
  }

  function handleDuration(actionId: string, minutes: number) {
    if (!card || !Number.isFinite(minutes) || minutes < 10 || minutes > 300) return
    runMutation(() => api.updateAction(card.courseId, card.topicId, actionId, minutes))
  }

  function handleMastery(level: MasteryLevel) {
    if (!card) return
    runMutation(() => api.setTopicProgress(card.courseId, card.topicId, { masteryLevel: level }))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="sr-only">{card.name}</DialogTitle>

        <div className="space-y-4">
          <div>
            <Link
              to={`/courses/${card.courseId}`}
              className="text-xs font-medium text-muted-foreground hover:text-primary hover:underline"
            >
              {card.courseName}
            </Link>
            <div className="mt-1 flex items-start gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={handleRename}
                aria-label="Topic name"
                className="w-full rounded-md bg-transparent text-lg font-semibold outline-none hover:bg-muted focus:bg-muted"
              />
              <button
                onClick={handleTogglePriority}
                aria-label={card.isPriority ? 'Remove core topic flag' : 'Mark as core topic'}
                className={
                  card.isPriority
                    ? 'shrink-0 text-amber-500'
                    : 'shrink-0 text-muted-foreground hover:text-amber-500'
                }
              >
                <Star className="size-5" fill={card.isPriority ? 'currentColor' : 'none'} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={card.status === 'done' ? 'success' : 'neutral'}>
                {STATUS_LABELS[card.status]}
              </Badge>
              {card.isPriority && <Badge tone="accent">Core topic</Badge>}
              <span className="text-xs text-muted-foreground">{card.totalMinutes} min total</span>
            </div>
          </div>

          {error && <ErrorNote message={error} />}

          <div>
            <h3 className="mb-2 text-sm font-medium">Learning actions</h3>
            <div className="space-y-2">
              {card.actions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-2.5"
                >
                  <input
                    type="checkbox"
                    checked={action.isDone}
                    onChange={(event) => handleToggleAction(action.id, event.target.checked)}
                    className="size-4 rounded border-border accent-indigo-600"
                    aria-label={`${ACTION_LABELS[action.type]} done`}
                  />
                  <span
                    className={
                      action.isDone
                        ? 'flex-1 text-sm text-muted-foreground line-through'
                        : 'flex-1 text-sm'
                    }
                  >
                    {ACTION_LABELS[action.type]}
                  </span>
                  <Input
                    type="number"
                    min={10}
                    max={300}
                    step={5}
                    defaultValue={action.durationMinutes}
                    onBlur={(event) => handleDuration(action.id, Number(event.target.value))}
                    aria-label={`${ACTION_LABELS[action.type]} minutes`}
                    className="w-20 py-1 text-right text-sm"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              ))}
            </div>
          </div>

          {card.needsMasteryRating && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
              <p className="mb-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                All done. How well do you know this topic?
              </p>
              <MasteryPicker value={null} onChange={handleMastery} />
            </div>
          )}

          {card.masteryLevel != null && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Mastery</span>
              <MasteryPicker value={card.masteryLevel} onChange={handleMastery} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
