import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { api } from '../api/client'
import type { Board, BoardCard, Course, TopicStatus } from '../types'
import { ACTION_LABELS, STATUS_LABELS, STATUS_ORDER } from '../types'
import {
  Badge,
  EmptyState,
  ErrorNote,
  PageHeader,
  ProgressBar,
  Select,
  Spinner,
} from '../components/ui/primitives'
import { cn } from '../lib/utils'

/**
 * Kanban board (FR4). Status is normally derived from the work done (FR4.2),
 * but a card can be dragged to another column to override it (FR4.3) - useful
 * for pulling something out of the backlog into this week's plan.
 *
 * Uses the browser's native drag-and-drop rather than a library: it's a handful
 * of events and keeps the dependency list small.
 */
export function BoardPage() {
  const [board, setBoard] = useState<Board | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [courseFilter, setCourseFilter] = useState('')
  const [draggedCard, setDraggedCard] = useState<BoardCard | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<TopicStatus | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [loadedBoard, loadedCourses] = await Promise.all([
        api.getBoard(courseFilter || undefined),
        api.listCourses(),
      ])
      setBoard(loadedBoard)
      setCourses(loadedCourses)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the board')
    } finally {
      setIsLoading(false)
    }
  }, [courseFilter])

  useEffect(() => {
    load()
  }, [load])

  async function handleDrop(status: TopicStatus) {
    setDragOverColumn(null)
    if (!draggedCard || draggedCard.status === status) return

    const card = draggedCard
    setDraggedCard(null)

    // Move the card straight away so the drag feels responsive, then confirm
    // with the server and reload the derived state.
    setBoard((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((item) =>
              item.topicId === card.topicId ? { ...item, status } : item,
            ),
          }
        : current,
    )

    try {
      await api.setTopicProgress(card.courseId, card.topicId, { status })
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not move that card')
      await load()
    }
  }

  if (isLoading) return <Spinner label="Loading board" />

  return (
    <>
      <PageHeader
        title="Sprint board"
        subtitle="Drag a card to plan it in. Status updates on its own as you tick actions off."
        action={
          <Select
            value={courseFilter}
            onChange={(event) => setCourseFilter(event.target.value)}
            className="w-52"
            aria-label="Filter by course"
          >
            <option value="">All courses</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </Select>
        }
      />

      {error && <ErrorNote message={error} />}

      {board && board.totalTopics === 0 ? (
        <EmptyState
          title="Nothing to study yet"
          description="Add a course and some topics, and they'll show up here as cards you can move through the sprint."
          action={
            <Link to="/courses" className="text-sm font-medium text-primary hover:underline">
              Go to courses
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {STATUS_ORDER.map((status) => {
            const cards = board?.cards.filter((card) => card.status === status) ?? []

            return (
              <div
                key={status}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOverColumn(status)
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={() => handleDrop(status)}
                className={cn(
                  'min-h-56 rounded-xl border p-3 transition-colors',
                  dragOverColumn === status
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-muted/40',
                  // "To do" is what the student should pick up next, so it stands out (FR4.4).
                  status === 'todo' && dragOverColumn !== status && 'border-primary/40',
                )}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-medium">{STATUS_LABELS[status]}</h2>
                  <span className="text-xs text-muted-foreground">{cards.length}</span>
                </div>

                <div className="space-y-2">
                  {cards.map((card) => (
                    <TopicCard
                      key={card.topicId}
                      card={card}
                      onDragStart={() => setDraggedCard(card)}
                      onDragEnd={() => setDraggedCard(null)}
                      isDragging={draggedCard?.topicId === card.topicId}
                    />
                  ))}

                  {cards.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                      {status === 'in_progress' ? 'Drag a topic here to start studying' : 'Empty'}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function TopicCard({
  card,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  card: BoardCard
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'cursor-grab rounded-lg border border-border bg-card p-3 active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/courses/${card.courseId}`}
          className="text-sm font-medium leading-snug hover:text-primary hover:underline"
        >
          {card.name}
        </Link>
        {card.isPriority && (
          <Star className="size-3.5 shrink-0 text-amber-500" fill="currentColor" aria-label="Core topic" />
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">{card.courseName}</p>

      <div className="mt-2.5">
        <ProgressBar value={card.actionsDone} max={card.actions.length} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.actions.map((action) => (
          <span
            key={action.id}
            title={ACTION_LABELS[action.type]}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              action.isDone
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {ACTION_LABELS[action.type]}
          </span>
        ))}
      </div>

      {card.needsMasteryRating && (
        <p className="mt-2">
          <Badge tone="warning">Rate your mastery</Badge>
        </p>
      )}
      {card.masteryLevel != null && (
        <p className="mt-2 text-xs text-muted-foreground">Mastery {card.masteryLevel}/5</p>
      )}
    </article>
  )
}
