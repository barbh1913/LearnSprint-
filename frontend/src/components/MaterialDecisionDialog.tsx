import { useState } from 'react'
import { FilePlus, FolderInput, Sparkles } from 'lucide-react'
import type { BoardCard, MaterialAnalysis } from '../types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Badge, Button, ErrorNote, Input, Select } from './ui/primitives'

type Choice = 'recommended' | 'other' | 'create'

/**
 * "Material analysed" - the student's decision after one file was understood
 * and matched (FR2.8). LearnSprint recommends; the student always chooses:
 * attach to the recommended topic, pick another topic, or create a new one.
 */
export function MaterialDecisionDialog({
  analysis,
  topics,
  onConfirm,
  onClose,
}: {
  analysis: MaterialAnalysis | null
  /** The course's topics, for "choose another". */
  topics: BoardCard[]
  onConfirm: (
    decision: { decision: 'attach'; topicId: string } | { decision: 'create'; title: string },
  ) => Promise<void>
  onClose: () => void
}) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [otherTopicId, setOtherTopicId] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  if (!analysis) return null

  const { recommendation, content } = analysis
  const recommended = recommendation.decision === 'attach_existing' ? recommendation : null
  const newTitle = title || recommendation.suggestedTitle

  async function submit(
    decision: { decision: 'attach'; topicId: string } | { decision: 'create'; title: string },
  ) {
    setIsBusy(true)
    setError('')
    try {
      await onConfirm(decision)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That could not be saved')
      setIsBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>Material analysed</DialogTitle>
        <DialogDescription>
          {analysis.fileName}
          {analysis.analysedBy === 'heuristic' && ' · analysed with the built-in analyser'}
        </DialogDescription>

        <div className="space-y-4">
          {analysis.note && <p className="text-xs text-muted-foreground">{analysis.note}</p>}

          {content.summary && <p className="text-sm">{content.summary}</p>}

          {content.keyPoints.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Detected topics</p>
              <div className="flex flex-wrap gap-1.5">
                {content.keyPoints.map((point) => (
                  <Badge key={point}>{point}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden />
              <span className="text-sm font-medium">
                {recommended ? `Recommended: ${recommended.topicName}` : 'Recommended: create a new topic'}
              </span>
              {recommended && (
                <Badge tone={recommended.confidence >= 0.7 ? 'success' : 'warning'}>
                  {recommended.confidence >= 0.7 ? 'High relevance' : 'Possible match'} ·{' '}
                  {Math.round(recommended.confidence * 100)}%
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{recommendation.reason}</p>
          </div>

          {error && <ErrorNote message={error} />}

          <div className="space-y-2">
            {recommended && (
              <Button
                variant="primary"
                className="w-full justify-start"
                disabled={isBusy}
                onClick={() => submit({ decision: 'attach', topicId: recommended.topicId! })}
              >
                <FolderInput className="size-4" aria-hidden />
                Attach to {recommended.topicName}
              </Button>
            )}

            <Button
              variant={choice === 'other' ? 'primary' : 'secondary'}
              className="w-full justify-start"
              disabled={isBusy || topics.length === 0}
              onClick={() => setChoice('other')}
              aria-expanded={choice === 'other'}
            >
              <FolderInput className="size-4" aria-hidden />
              Choose another topic
            </Button>
            {choice === 'other' && (
              <div className="flex gap-2 pl-6">
                <Select
                  value={otherTopicId}
                  onChange={(event) => setOtherTopicId(event.target.value)}
                  aria-label="Topic to attach to"
                  className="flex-1"
                >
                  <option value="">Pick a topic</option>
                  {topics.map((topic) => (
                    <option key={topic.topicId} value={topic.topicId}>
                      {topic.name}
                      {recommendation.alternatives.some((alt) => alt.topicId === topic.topicId)
                        ? ' · suggested'
                        : ''}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isBusy || !otherTopicId}
                  onClick={() => submit({ decision: 'attach', topicId: otherTopicId })}
                >
                  Attach
                </Button>
              </div>
            )}

            <Button
              variant={choice === 'create' ? 'primary' : 'secondary'}
              className="w-full justify-start"
              disabled={isBusy}
              onClick={() => setChoice('create')}
              aria-expanded={choice === 'create'}
            >
              <FilePlus className="size-4" aria-hidden />
              Create a new topic
            </Button>
            {choice === 'create' && (
              <div className="flex gap-2 pl-6">
                <Input
                  value={newTitle}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label="New topic title"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isBusy || !newTitle.trim()}
                  onClick={() => submit({ decision: 'create', title: newTitle.trim() })}
                >
                  Create
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
