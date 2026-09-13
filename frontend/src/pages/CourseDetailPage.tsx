import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Star, Trash2, Upload } from 'lucide-react'
import { api } from '../api/client'
import type { BoardCard, Course, MasteryLevel } from '../types'
import { ACTION_LABELS, STATUS_LABELS } from '../types'
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
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const [loadedCourse, board] = await Promise.all([
        api.getCourse(courseId),
        api.getBoard(courseId),
      ])
      setCourse(loadedCourse)
      setCards(board.cards)
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
            : 'Using default time estimates — turn on AI analysis in your profile for real estimates.',
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
    runMutation(() => api.updateTopic(courseId, card.topicId, { isPriority: !card.isPriority }))
  }

  function handleDeleteTopic(card: BoardCard) {
    if (!confirm(`Delete "${card.name}"? This also removes everyone's progress on it.`)) return
    runMutation(() => api.deleteTopic(courseId, card.topicId))
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
          Upload up to 15 PDF or PPTX files at once — they're analysed together to work out
          the topics and how long each takes to learn.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.pptx"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              if (files.length > 0) handleUpload(files)
            }}
          />
          <Button onClick={() => fileInput.current?.click()} disabled={isUploading}>
            <Upload className="size-4" aria-hidden />
            {isUploading ? 'Analysing material' : 'Upload course material'}
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
          {cards.map((card) => (
            <TopicRow
              key={card.topicId}
              card={card}
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
    </>
  )
}

function TopicRow({
  card,
  onRename,
  onTogglePriority,
  onDelete,
  onToggleAction,
  onMastery,
}: {
  card: BoardCard
  onRename: (name: string) => void
  onTogglePriority: () => void
  onDelete: () => void
  onToggleAction: (actionId: string, isDone: boolean) => void
  onMastery: (level: MasteryLevel) => void
}) {
  const [name, setName] = useState(card.name)

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
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
              {ACTION_LABELS[action.type]}
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
