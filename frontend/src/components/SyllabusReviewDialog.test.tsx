import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardCard, SyllabusAnalysis } from '../types'
import { SyllabusReviewDialog } from './SyllabusReviewDialog'

function topic(topicId: string, name: string): BoardCard {
  return {
    topicId,
    courseId: 'c1',
    courseName: 'Algorithms',
    name,
    description: null,
    priority: 'medium',
    isPriority: false,
    masteryLevel: null,
    status: 'backlog',
    needsMasteryRating: false,
    actions: [],
    actionsDone: 0,
    totalMinutes: 0,
  }
}

const noMatch = {
  decision: 'create_new' as const,
  topicId: null,
  topicName: null,
  confidence: 0,
  reason: 'nothing close',
  suggestedTitle: '',
  alternatives: [],
}

const analysis: SyllabusAnalysis = {
  materialId: 's1',
  fileName: 'syllabus.pdf',
  analysedBy: 'ai',
  note: null,
  proposals: [
    { index: 0, title: 'Sorting', summary: null, keyPoints: ['quicksort', 'mergesort'], estimatedMinutes: 120, match: noMatch },
    {
      index: 1,
      title: 'Graph Algorithms',
      summary: null,
      keyPoints: [],
      estimatedMinutes: 90,
      match: { ...noMatch, decision: 'attach_existing', topicId: 't-graphs', topicName: 'Graph Algorithms', confidence: 0.9 },
    },
    { index: 2, title: 'Hashing', summary: null, keyPoints: [], estimatedMinutes: null, match: noMatch },
  ],
}

describe('SyllabusReviewDialog', () => {
  it('proposes lectures, defaulting a matched one to attach, and confirms the reviewed list', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <SyllabusReviewDialog
        analysis={analysis}
        topics={[topic('t-graphs', 'Graph Algorithms')]}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(/3 lectures proposed/)).toBeInTheDocument()
    expect(screen.getByLabelText('Decision for proposal 2')).toHaveValue('attach')
    expect(screen.getByText(/Looks like Graph Algorithms · 90%/)).toBeInTheDocument()
    expect(screen.getByText('2 to create · 1 to attach · 0 skipped')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Title of proposal 1'), { target: { value: 'Sorting algorithms' } })
    fireEvent.change(screen.getByLabelText('Decision for proposal 3'), { target: { value: 'skip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith([
        { index: 0, decision: 'create', title: 'Sorting algorithms' },
        { index: 1, decision: 'attach', topicId: 't-graphs' },
        { index: 2, decision: 'skip' },
      ]),
    )
  })

  it('will not confirm an attach without a topic', () => {
    render(<SyllabusReviewDialog analysis={analysis} topics={[]} onConfirm={vi.fn()} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Decision for proposal 1'), { target: { value: 'attach' } })

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })
})
