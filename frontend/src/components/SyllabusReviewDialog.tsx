import { useState } from 'react'
import type { BoardCard, SyllabusAnalysis, SyllabusItemDecision } from '../types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Badge, Button, ErrorNote, Input, Select } from './ui/primitives'

interface Row {
  index: number
  title: string
  decision: 'create' | 'attach' | 'skip'
  topicId: string
}

/**
 * Review the lecture-level topics proposed from a syllabus before any of them
 * exist (FR2.10). Rename, drop, or keep a proposal as a match to a topic the
 * course already has; nothing is created until Confirm.
 */
export function SyllabusReviewDialog({
  analysis,
  topics,
  onConfirm,
  onClose,
}: {
  analysis: SyllabusAnalysis | null
  topics: BoardCard[]
  onConfirm: (items: SyllabusItemDecision[]) => Promise<void>
  onClose: () => void
}) {
  const [rows, setRows] = useState<Row[]>(() => initialRows(analysis))
  const [error, setError] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  if (!analysis) return null

  function update(index: number, changes: Partial<Row>) {
    setRows((current) => current.map((row) => (row.index === index ? { ...row, ...changes } : row)))
  }

  async function submit() {
    setIsBusy(true)
    setError('')
    try {
      await onConfirm(
        rows.map((row) => ({
          index: row.index,
          decision: row.decision,
          ...(row.decision === 'create' ? { title: row.title.trim() } : {}),
          ...(row.decision === 'attach' ? { topicId: row.topicId } : {}),
        })),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That could not be saved')
      setIsBusy(false)
    }
  }

  const willCreate = rows.filter((row) => row.decision === 'create').length
  const willAttach = rows.filter((row) => row.decision === 'attach').length
  const invalid = rows.some(
    (row) =>
      (row.decision === 'create' && !row.title.trim()) ||
      (row.decision === 'attach' && !row.topicId),
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Syllabus analysed</DialogTitle>
        <DialogDescription>
          {analysis.fileName} · {analysis.proposals.length} lectures proposed
          {analysis.analysedBy === 'heuristic' && ' by the built-in analyser'}. Nothing is created until
          you confirm.
        </DialogDescription>

        {analysis.note && <p className="text-xs text-muted-foreground">{analysis.note}</p>}
        {error && <ErrorNote message={error} />}

        <div className="space-y-2">
          {analysis.proposals.map((proposal) => {
            const row = rows.find((item) => item.index === proposal.index)
            if (!row) return null
            const matched = proposal.match.decision === 'attach_existing' ? proposal.match : null
            return (
              <div
                key={proposal.index}
                className="rounded-lg border border-border p-3"
                aria-label={`Proposal ${proposal.index + 1}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={row.title}
                    onChange={(event) => update(row.index, { title: event.target.value })}
                    disabled={row.decision !== 'create'}
                    aria-label={`Title of proposal ${proposal.index + 1}`}
                    className="min-w-48 flex-1"
                  />
                  <Select
                    value={row.decision}
                    onChange={(event) =>
                      update(row.index, { decision: event.target.value as Row['decision'] })
                    }
                    aria-label={`Decision for proposal ${proposal.index + 1}`}
                    className="w-40"
                  >
                    <option value="create">Create topic</option>
                    <option value="attach">Attach to existing</option>
                    <option value="skip">Skip</option>
                  </Select>
                  {row.decision === 'attach' && (
                    <Select
                      value={row.topicId}
                      onChange={(event) => update(row.index, { topicId: event.target.value })}
                      aria-label={`Topic for proposal ${proposal.index + 1}`}
                      className="w-48"
                    >
                      <option value="">Pick a topic</option>
                      {topics.map((topic) => (
                        <option key={topic.topicId} value={topic.topicId}>
                          {topic.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {proposal.estimatedMinutes != null && <Badge>{proposal.estimatedMinutes} min</Badge>}
                  {matched && (
                    <Badge tone="warning">
                      Looks like {matched.topicName} · {Math.round(matched.confidence * 100)}%
                    </Badge>
                  )}
                  {proposal.keyPoints.length > 0 && <span>{proposal.keyPoints.join(' · ')}</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {willCreate} to create · {willAttach} to attach · {rows.length - willCreate - willAttach} skipped
          </p>
          <div className="flex gap-2">
            <Button onClick={onClose} disabled={isBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={isBusy || invalid}>
              {isBusy ? 'Creating' : 'Confirm'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function initialRows(analysis: SyllabusAnalysis | null): Row[] {
  if (!analysis) return []
  return analysis.proposals.map((proposal) => {
    const matched = proposal.match.decision === 'attach_existing'
    return {
      index: proposal.index,
      title: proposal.title,
      // A proposal that already matches a topic defaults to attaching, so a
      // re-analysed syllabus doesn't duplicate the backlog.
      decision: matched ? 'attach' : 'create',
      topicId: matched ? (proposal.match.topicId ?? '') : '',
    }
  })
}
