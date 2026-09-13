import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Paperclip, Plus, Trash2, User } from 'lucide-react'
import { api } from '../api/client'
import type { BoardCard, MasteryLevel, Material, Priority, TopicStatus } from '../types'
import { PRIORITY_LABELS, PRIORITY_ORDER, STATUS_LABELS, STATUS_ORDER } from '../types'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Badge, Button, ErrorNote, Input, Select } from './ui/primitives'
import { MasteryPicker } from './MasteryPicker'
import { cn } from '../lib/utils'

const NEW_SUBTASK_MINUTES = 30

/**
 * Jira/Linear-style detail view for one topic - the task (ADR 0012). Opened
 * from the board and from a Calendar event alike, and edits the same shared
 * topic either way: title, description, status, priority, estimate, subtasks
 * (FR2.2, FR2.3), the student's attached materials (FR2.9), mastery.
 */
export function TopicDetailDialog({
  card,
  highlightActionIds = [],
  onClose,
  onChanged,
  openExternal = (url) => window.open(url, '_blank', 'noopener'),
}: {
  card: BoardCard | null
  /** The subtasks the user came from - a Calendar event points at some of them. */
  highlightActionIds?: string[]
  onClose: () => void
  onChanged: () => void
  /** Overridable so tests can catch a download instead of opening a window. */
  openExternal?: (url: string) => void
}) {
  const [name, setName] = useState(card?.name ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [materials, setMaterials] = useState<Material[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const topicId = card?.topicId ?? null
  const courseId = card?.courseId ?? null

  useEffect(() => {
    setName(card?.name ?? '')
    setDescription(card?.description ?? '')
    setError('')
  }, [card?.topicId, card?.name, card?.description])

  useEffect(() => {
    if (!topicId || !courseId) {
      setMaterials([])
      return
    }
    api
      .listMaterials(courseId, topicId)
      .then(setMaterials)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load attachments'))
  }, [courseId, topicId])

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

  function handleDescription() {
    if (!card) return
    const next = description.trim() || null
    if (next === (card.description ?? null)) return
    runMutation(() => api.updateTopic(card.courseId, card.topicId, { description: next }))
  }

  function handleStatus(status: TopicStatus) {
    if (!card || status === card.status) return
    runMutation(() => api.setTopicProgress(card.courseId, card.topicId, { status }))
  }

  function handlePriority(priority: Priority) {
    if (!card || priority === card.priority) return
    runMutation(() => api.updateTopic(card.courseId, card.topicId, { priority }))
  }

  function handleEstimate(minutes: number) {
    if (!card || !Number.isFinite(minutes) || minutes === card.totalMinutes) return
    runMutation(() => api.updateTopic(card.courseId, card.topicId, { estimatedMinutes: minutes }))
  }

  function handleToggleAction(actionId: string, isDone: boolean) {
    if (!card) return
    runMutation(() => api.setActionDone(card.courseId, actionId, isDone))
  }

  function handleActionTitle(actionId: string, current: string, title: string) {
    if (!card || !title.trim() || title.trim() === current) return
    runMutation(() => api.updateAction(card.courseId, card.topicId, actionId, { title: title.trim() }))
  }

  function handleDuration(actionId: string, current: number, minutes: number) {
    if (!card || !Number.isFinite(minutes) || minutes < 10 || minutes > 300 || minutes === current) return
    runMutation(() =>
      api.updateAction(card.courseId, card.topicId, actionId, { durationMinutes: minutes }),
    )
  }

  function handleAddSubtask(event: React.FormEvent) {
    event.preventDefault()
    if (!card) return
    const title = newSubtask.trim()
    if (!title) return
    runMutation(async () => {
      await api.createAction(card.courseId, card.topicId, title, NEW_SUBTASK_MINUTES)
      setNewSubtask('')
    })
  }

  function handleDeleteAction(actionId: string, title: string) {
    if (!card) return
    if (!confirm(`Delete "${title}"? This also removes everyone's progress on it.`)) return
    runMutation(() => api.deleteAction(card.courseId, card.topicId, actionId))
  }

  function handleMastery(level: MasteryLevel) {
    if (!card) return
    runMutation(() => api.setTopicProgress(card.courseId, card.topicId, { masteryLevel: level }))
  }

  async function reloadMaterials() {
    if (!card) return
    setMaterials(await api.listMaterials(card.courseId, card.topicId))
  }

  async function handleUpload(files: File[]) {
    if (!card || files.length === 0) return
    setIsUploading(true)
    try {
      await api.uploadMaterials(card.courseId, card.topicId, files)
      await reloadMaterials()
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload those files')
    } finally {
      setIsUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function handleDownload(material: Material) {
    if (!card) return
    try {
      const link = await api.getMaterialDownloadLink(card.courseId, card.topicId, material.id)
      openExternal(link.url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not fetch a download link')
    }
  }

  async function handleDeleteMaterial(material: Material) {
    if (!card) return
    if (!confirm(`Delete "${material.fileName}"?`)) return
    try {
      await api.deleteMaterial(card.courseId, card.topicId, material.id)
      await reloadMaterials()
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that file')
    }
  }

  const subtasks = [...card.actions].sort((a, b) => a.order - b.order)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle className="sr-only">{card.name}</DialogTitle>

        <div className="space-y-5">
          <div>
            <Link
              to={`/courses/${card.courseId}`}
              className="text-xs font-medium text-muted-foreground hover:text-primary hover:underline"
            >
              {card.courseName}
            </Link>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={handleRename}
              aria-label="Topic name"
              className="mt-1 w-full rounded-md bg-transparent text-lg font-semibold outline-none hover:bg-muted focus:bg-muted"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {card.priority === 'high' && <Badge tone="accent">Core topic</Badge>}
              {card.needsMasteryRating && <Badge tone="warning">Rate your mastery</Badge>}
            </div>
          </div>

          {error && <ErrorNote message={error} />}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Status</span>
              <Select
                value={card.status}
                onChange={(event) => handleStatus(event.target.value as TopicStatus)}
                aria-label="Status"
              >
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Priority</span>
              <Select
                value={card.priority}
                onChange={(event) => handlePriority(event.target.value as Priority)}
                aria-label="Priority"
              >
                {PRIORITY_ORDER.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Estimated time (minutes)
              </span>
              <Input
                key={card.totalMinutes}
                type="number"
                min={10 * subtasks.length}
                max={3000}
                step={5}
                defaultValue={card.totalMinutes}
                onBlur={(event) => handleEstimate(Number(event.target.value))}
                aria-label="Estimated minutes"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Split across the subtasks in proportion.
              </span>
            </label>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Assignee</span>
              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <User className="size-4 text-muted-foreground" aria-hidden />
                Me
              </div>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={handleDescription}
              placeholder="What this topic covers, what to focus on, links to the lecture..."
              aria-label="Description"
              rows={3}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>

          <div>
            <h3 className="mb-2 text-sm font-medium">Subtasks</h3>
            <div className="space-y-2">
              {subtasks.map((action) => (
                <div
                  key={action.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border border-border p-2',
                    highlightActionIds.includes(action.id) && 'border-primary ring-2 ring-primary/30',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={action.isDone}
                    onChange={(event) => handleToggleAction(action.id, event.target.checked)}
                    className="size-4 shrink-0 rounded border-border accent-indigo-600"
                    aria-label={`${action.title} done`}
                  />
                  <input
                    key={action.title}
                    defaultValue={action.title}
                    onBlur={(event) => handleActionTitle(action.id, action.title, event.target.value)}
                    aria-label={`${action.title} title`}
                    className={cn(
                      'min-w-0 flex-1 rounded-md bg-transparent px-1 text-sm outline-none hover:bg-muted focus:bg-muted',
                      action.isDone && 'text-muted-foreground line-through',
                    )}
                  />
                  <Input
                    key={`${action.id}-${action.durationMinutes}`}
                    type="number"
                    min={10}
                    max={300}
                    step={5}
                    defaultValue={action.durationMinutes}
                    onBlur={(event) =>
                      handleDuration(action.id, action.durationMinutes, Number(event.target.value))
                    }
                    aria-label={`${action.title} minutes`}
                    className="w-20 py-1 text-right text-sm"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteAction(action.id, action.title)}
                    disabled={subtasks.length === 1}
                    aria-label={`Delete ${action.title}`}
                    title={subtasks.length === 1 ? 'A topic keeps at least one subtask' : undefined}
                    className="text-muted-foreground transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddSubtask} className="mt-2 flex gap-2">
              <Input
                value={newSubtask}
                onChange={(event) => setNewSubtask(event.target.value)}
                placeholder="Add a subtask, e.g. Solve exercise sheet 3"
                aria-label="New subtask"
                className="flex-1"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={!newSubtask.trim()}>
                <Plus className="size-4" aria-hidden />
                Add
              </Button>
            </form>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium">Attachments</h3>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                aria-label="Attach files"
                onChange={(event) => handleUpload(Array.from(event.target.files ?? []))}
              />
              <Button size="sm" onClick={() => fileInput.current?.click()} disabled={isUploading}>
                <Paperclip className="size-4" aria-hidden />
                {isUploading ? 'Uploading' : 'Attach files'}
              </Button>
            </div>
            {materials.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No files yet. Lecture slides, exercise sheets, your own notes - they stay exactly as uploaded.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {materials.map((material) => (
                  <li
                    key={material.id}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{material.fileName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatSize(material.sizeBytes)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDownload(material)}
                      aria-label={`Download ${material.fileName}`}
                      className="text-muted-foreground hover:text-primary"
                    >
                      <Download className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMaterial(material)}
                      aria-label={`Delete ${material.fileName}`}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
