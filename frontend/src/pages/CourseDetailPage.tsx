import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileSearch, ListTree, Plus, Star, Trash2, Upload } from 'lucide-react'
import { api } from '../api/client'
import type {
  BoardCard,
  Course,
  MasteryLevel,
  MaterialAnalysis,
  SyllabusAnalysis,
  SyllabusItemDecision,
} from '../types'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog'
import { STATUS_LABELS } from '../types'
import { MaterialDecisionDialog } from '../components/MaterialDecisionDialog'
import { SyllabusReviewDialog } from '../components/SyllabusReviewDialog'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  ProgressBar,
  Spinner,
} from '../components/ui/primitives'
import { MasteryPicker } from '../components/MasteryPicker'
import { CourseMembers } from '../components/CourseMembers'

/** Single-course view (FR1.4): topics, their actions, and mastery in one place. */
export function CourseDetailPage() {
  const { courseId = '' } = useParams()
  const [course, setCourse] = useState<Course | null>(null)
  const [cards, setCards] = useState<BoardCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadNote, setUploadNote] = useState('')
  const [analysis, setAnalysis] = useState<MaterialAnalysis | null>(null)
  const [syllabus, setSyllabus] = useState<SyllabusAnalysis | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeletingSelected, setIsDeletingSelected] = useState(false)
  const [deleteTargets, setDeleteTargets] = useState<BoardCard[]>([])
  const [deleteError, setDeleteError] = useState('')
  const deleteInFlight = useRef(false)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const singleFileInput = useRef<HTMLInputElement>(null)
  const syllabusInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const [loadedCourse, board] = await Promise.all([
        api.getCourse(courseId),
        api.getBoard(courseId),
      ])
      setCourse(loadedCourse)
      setCards(board.cards)
      // A topic another member deleted meanwhile must not stay selected.
      setSelectedIds((current) => {
        const stillThere = new Set(board.cards.map((card) => card.topicId))
        return new Set([...current].filter((id) => stillThere.has(id)))
      })
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the course')
    } finally {
      setIsLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    load()
  }, [load])

  async function handleUpload(files: File[]) {
    setIsUploading(true)
    setUploadNote('')
    setError('')

    try {
      const result = await api.extractTopics(courseId, files)
      const hours = Math.round(result.totalEstimatedMinutes / 60)
      const source =
        result.sourceFilenames.length === 1
          ? result.sourceFilenames[0]
          : `${result.sourceFilenames.length} files`

      setUploadNote(
        [
          `Found ${result.created.length} topics across ${source}`,
          result.analysedBy === 'ai'
            ? `AI estimated about ${hours}h of study time in total.`
            : 'Using default time estimates (AI analysis is not available on this server).',
          result.note,
        ]
          .filter(Boolean)
          .join('. '),
      )
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read those files')
    } finally {
      setIsUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /** One file: understand it, then let the student decide where it belongs (FR2.8). */
  async function handleAnalyzeFile(file: File) {
    setIsUploading(true)
    setUploadNote('')
    setError('')
    try {
      setAnalysis(await api.analyzeMaterial(courseId, file))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not analyse that file')
    } finally {
      setIsUploading(false)
      if (singleFileInput.current) singleFileInput.current.value = ''
    }
  }

  async function handleConfirmMaterial(
    decision: { decision: 'attach'; topicId: string } | { decision: 'create'; title: string },
  ) {
    if (!analysis) return
    const result = await api.confirmMaterial(courseId, analysis.materialId, decision)
    setAnalysis(null)
    setUploadNote(
      result.created
        ? `Created "${result.topicName}" from ${analysis.fileName}.`
        : `Filed ${analysis.fileName} under "${result.topicName}".`,
    )
    await load()
  }

  /** A syllabus: propose lecture-level topics for review before anything is created (FR2.10). */
  async function handleAnalyzeSyllabus(file: File) {
    setIsUploading(true)
    setUploadNote('')
    setError('')
    try {
      setSyllabus(await api.analyzeSyllabus(courseId, file))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not analyse that syllabus')
    } finally {
      setIsUploading(false)
      if (syllabusInput.current) syllabusInput.current.value = ''
    }
  }

  async function handleConfirmSyllabus(items: SyllabusItemDecision[]) {
    if (!syllabus) return
    const result = await api.confirmSyllabus(courseId, syllabus.materialId, items)
    setSyllabus(null)
    setUploadNote(
      `${result.created.length} topics created and ${result.attached.length} matched from ${syllabus.fileName}.`,
    )
    await load()
  }

  /** Runs a topic/action mutation, surfacing a failure instead of it silently
   * doing nothing, then reloads the board so derived state (status, progress
   * bars) stays in sync with what the server actually saved. */
  async function runMutation(action: () => Promise<unknown>) {
    try {
      await action()
      setError('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That change could not be saved')
    }
  }

  function handleAddTopic(event: React.FormEvent) {
    event.preventDefault()
    const name = newTopic.trim()
    if (!name) return

    runMutation(async () => {
      await api.createTopic(courseId, name)
      setNewTopic('')
    })
  }

  function handleRename(card: BoardCard, name: string) {
    if (!name.trim() || name === card.name) return
    runMutation(() => api.updateTopic(courseId, card.topicId, { name: name.trim() }))
  }

  function handleTogglePriority(card: BoardCard) {
    // The star is the quick way to flag a core topic; the detail dialog offers all three levels.
    const priority = card.priority === 'high' ? 'medium' : 'high'
    runMutation(() => api.updateTopic(courseId, card.topicId, { priority }))
  }

  function handleDeleteTopic(card: BoardCard) {
    setDeleteError('')
    setDeleteTargets([card])
  }

  function toggleSelected(topicId: string, isSelected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (isSelected) next.add(topicId)
      else next.delete(topicId)
      return next
    })
  }

  function toggleSelectAll(isSelected: boolean) {
    setSelectedIds(isSelected ? new Set(cards.map((card) => card.topicId)) : new Set())
  }

  function handleDeleteSelected() {
    setDeleteError('')
    setDeleteTargets(cards.filter((card) => selectedIds.has(card.topicId)))
  }

  async function confirmDeleteTopics() {
    if (deleteInFlight.current || deleteTargets.length === 0) return
    deleteInFlight.current = true
    setIsDeletingSelected(true)
    setDeleteError('')
    const remaining = [...deleteTargets]
    try {
      while (remaining.length > 0) {
        await api.deleteTopic(courseId, remaining[0].topicId)
        const deletedId = remaining.shift()!.topicId
        setCards((current) => current.filter((card) => card.topicId !== deletedId))
        setSelectedIds((current) => {
          const next = new Set(current)
          next.delete(deletedId)
          return next
        })
      }
      setDeleteTargets([])
      await load()
    } catch (caught) {
      setDeleteTargets(remaining)
      setDeleteError(caught instanceof Error ? caught.message : 'Could not delete the remaining topics')
    } finally {
      deleteInFlight.current = false
      setIsDeletingSelected(false)
    }
  }

  function handleToggleAction(actionId: string, isDone: boolean) {
    runMutation(() => api.setActionDone(courseId, actionId, isDone))
  }

  function handleMastery(card: BoardCard, level: MasteryLevel) {
    runMutation(() => api.setTopicProgress(courseId, card.topicId, { masteryLevel: level }))
  }

  if (isLoading) return <Spinner label="Loading course" />
  if (!course) return <ErrorNote message={error || 'Course not found'} />

  const totalActions = cards.reduce((sum, card) => sum + card.actions.length, 0)
  const doneActions = cards.reduce((sum, card) => sum + card.actionsDone, 0)

  return (
    <>
      <Link
        to="/courses"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All courses
      </Link>

      <PageHeader
        title={course.name}
        subtitle={`Year ${course.year} · Semester ${course.semester} · ${course.credits} credits${
          course.examDate ? ` · Exam ${new Date(course.examDate).toLocaleDateString()}` : ''
        }`}
      />

      <Card className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">Course progress</span>
          <span className="text-muted-foreground">
            {doneActions} of {totalActions} learning actions done
          </span>
        </div>
        <ProgressBar value={doneActions} max={totalActions} />
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 font-medium">Add topics</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Upload a batch of decks to extract topics at once, analyse one file to file it under
          the right topic, or analyse the syllabus to propose one topic per lecture.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.pptx"
            multiple
            className="hidden"
            aria-label="Upload course material"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              if (files.length > 0) handleUpload(files)
            }}
          />
          <Button onClick={() => fileInput.current?.click()} disabled={isUploading}>
            <Upload className="size-4" aria-hidden />
            {isUploading ? 'Analysing material' : 'Upload course material'}
          </Button>

          <input
            ref={singleFileInput}
            type="file"
            accept=".pdf,.pptx"
            className="hidden"
            aria-label="Analyse one file"
            onChange={(event) => {
              const [file] = Array.from(event.target.files ?? [])
              if (file) handleAnalyzeFile(file)
            }}
          />
          <Button onClick={() => singleFileInput.current?.click()} disabled={isUploading}>
            <FileSearch className="size-4" aria-hidden />
            Analyse one file
          </Button>

          <input
            ref={syllabusInput}
            type="file"
            accept=".pdf,.pptx"
            className="hidden"
            aria-label="Analyse a syllabus"
            onChange={(event) => {
              const [file] = Array.from(event.target.files ?? [])
              if (file) handleAnalyzeSyllabus(file)
            }}
          />
          <Button onClick={() => syllabusInput.current?.click()} disabled={isUploading}>
            <ListTree className="size-4" aria-hidden />
            Analyse a syllabus
          </Button>

          <span className="text-sm text-muted-foreground">or</span>

          <form onSubmit={handleAddTopic} className="flex flex-1 gap-2">
            <Input
              value={newTopic}
              onChange={(event) => setNewTopic(event.target.value)}
              placeholder="Type a topic name"
              className="flex-1"
            />
            <Button type="submit" variant="primary">
              <Plus className="size-4" aria-hidden />
              Add
            </Button>
          </form>
        </div>

        {uploadNote && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950">
            <p className="text-sm text-emerald-900 dark:text-emerald-200">{uploadNote}</p>
            <Link
              to="/calendar"
              className="mt-1 inline-block text-sm font-medium text-emerald-800 underline dark:text-emerald-300"
            >
              See the study sessions this created
            </Link>
          </div>
        )}
        {error && <div className="mt-3">{<ErrorNote message={error} />}</div>}
      </Card>

      {cards.length === 0 ? (
        <EmptyState
          title="No topics yet"
          description="Upload the course syllabus or slide deck and LearnSprint will pull the topics out of it."
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedIds.size === cards.length}
                onChange={(event) => toggleSelectAll(event.target.checked)}
                aria-label="Select all topics"
                className="size-4 rounded border-border accent-indigo-600"
              />
              {selectedIds.size === 0
                ? `${cards.length} topics`
                : `${selectedIds.size} of ${cards.length} selected`}
            </label>
            {selectedIds.size > 0 && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => void handleDeleteSelected()}
                disabled={isDeletingSelected}
              >
                <Trash2 className="size-4" aria-hidden />
                {isDeletingSelected ? 'Deleting' : `Delete selected (${selectedIds.size})`}
              </Button>
            )}
          </div>

          {cards.map((card) => (
            <TopicRow
              key={card.topicId}
              card={card}
              isSelected={selectedIds.has(card.topicId)}
              onSelect={(isSelected) => toggleSelected(card.topicId, isSelected)}
              onRename={(name) => handleRename(card, name)}
              onTogglePriority={() => handleTogglePriority(card)}
              onDelete={() => handleDeleteTopic(card)}
              onToggleAction={handleToggleAction}
              onMastery={(level) => handleMastery(card, level)}
            />
          ))}
        </div>
      )}

      <div className="mt-6">
        <CourseMembers courseId={courseId} />
      </div>

      <Dialog open={deleteTargets.length > 0} onOpenChange={(open) => {
        if (!open && !deleteInFlight.current) setDeleteTargets([])
      }}>
        <DialogContent
          showCloseButton={!isDeletingSelected}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancelDelete.current?.focus()
          }}
        >
          <DialogTitle>{deleteTargets.length === 1 ? 'Delete topic?' : 'Delete topics?'}</DialogTitle>
          <DialogDescription>
            {deleteTargets.length === 1
              ? `Delete "${deleteTargets[0].name}"?`
              : `Delete ${deleteTargets.length} selected topics?`}
            {' '}This also removes everyone's progress on these topics. This cannot be undone.
          </DialogDescription>
          {deleteError && <ErrorNote message={deleteError} />}
          <div className="flex justify-end gap-2">
            <button ref={cancelDelete} type="button" disabled={isDeletingSelected}
              onClick={() => setDeleteTargets([])}
              className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">
              Cancel
            </button>
            <Button type="button" variant="danger" disabled={isDeletingSelected}
              onClick={() => void confirmDeleteTopics()}>
              {isDeletingSelected ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <MaterialDecisionDialog
        key={analysis?.materialId ?? 'none'}
        analysis={analysis}
        topics={cards}
        onConfirm={handleConfirmMaterial}
        onClose={() => setAnalysis(null)}
      />
      <SyllabusReviewDialog
        key={syllabus?.materialId ?? 'none'}
        analysis={syllabus}
        topics={cards}
        onConfirm={handleConfirmSyllabus}
        onClose={() => setSyllabus(null)}
      />
    </>
  )
}

function TopicRow({
  card,
  isSelected,
  onSelect,
  onRename,
  onTogglePriority,
  onDelete,
  onToggleAction,
  onMastery,
}: {
  card: BoardCard
  isSelected: boolean
  onSelect: (isSelected: boolean) => void
  onRename: (name: string) => void
  onTogglePriority: () => void
  onDelete: () => void
  onToggleAction: (actionId: string, isDone: boolean) => void
  onMastery: (level: MasteryLevel) => void
}) {
  const [name, setName] = useState(card.name)

  return (
    <Card className={isSelected ? 'ring-2 ring-indigo-300 dark:ring-indigo-800' : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(event) => onSelect(event.target.checked)}
          aria-label={`Select ${card.name}`}
          className="mt-1 size-4 rounded border-border accent-indigo-600"
        />
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => onRename(name)}
            aria-label={`Topic name: ${card.name}`}
            className="w-full rounded-md bg-transparent font-medium outline-none hover:bg-muted focus:bg-muted"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={card.status === 'done' ? 'success' : 'neutral'}>
              {STATUS_LABELS[card.status]}
            </Badge>
            {card.isPriority && <Badge tone="accent">Core topic</Badge>}
            <span className="text-xs text-muted-foreground">{card.totalMinutes} min total</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onTogglePriority}
            aria-label={card.isPriority ? 'Remove core topic flag' : 'Mark as core topic'}
            className={card.isPriority ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'}
          >
            <Star className="size-4" fill={card.isPriority ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={onDelete}
            aria-label={`Delete ${card.name}`}
            className="text-muted-foreground transition-colors hover:text-red-600"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {card.actions.map((action) => (
          <label key={action.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={action.isDone}
              onChange={(event) => onToggleAction(action.id, event.target.checked)}
              className="size-4 rounded border-border accent-indigo-600"
            />
            <span className={action.isDone ? 'text-muted-foreground line-through' : ''}>
              {action.title}
            </span>
            <span className="text-xs text-muted-foreground">{action.durationMinutes}m</span>
          </label>
        ))}
      </div>

      {/* Once every action is ticked we need a mastery rating - it drives the
          review-session split (FR3.2) and the topic's final status (FR4.2). */}
      {card.needsMasteryRating && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          <p className="mb-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            All done. How well do you know this topic?
          </p>
          <MasteryPicker value={null} onChange={onMastery} />
        </div>
      )}

      {card.masteryLevel != null && (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Mastery</span>
          <MasteryPicker value={card.masteryLevel} onChange={onMastery} />
        </div>
      )}
    </Card>
  )
}
