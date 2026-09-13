import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardCard, MaterialAnalysis } from '../types'
import { MaterialDecisionDialog } from './MaterialDecisionDialog'

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

const topics = [topic('t-graphs', 'Graph Algorithms'), topic('t-trees', 'Binary Trees')]

function analysis(overrides: Partial<MaterialAnalysis['recommendation']> = {}): MaterialAnalysis {
  return {
    materialId: 'm1',
    fileName: 'lecture-05.pdf',
    analysedBy: 'ai',
    note: null,
    content: {
      title: 'Graph Algorithms',
      summary: 'Breadth-first and depth-first traversal, then shortest paths.',
      keyPoints: ['BFS', 'DFS', 'Dijkstra'],
      topics: ['Graph Algorithms'],
      estimatedMinutes: 120,
      language: 'en',
    },
    recommendation: {
      decision: 'attach_existing',
      topicId: 't-graphs',
      topicName: 'Graph Algorithms',
      confidence: 0.89,
      reason: "The material names 'Graph Algorithms' outright",
      suggestedTitle: 'Graph Algorithms',
      alternatives: [{ topicId: 't-trees', topicName: 'Binary Trees', confidence: 0.3, reason: 'little' }],
      ...overrides,
    },
  }
}

describe('MaterialDecisionDialog', () => {
  it('shows what was detected and the recommendation, and attaches to it in one click', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<MaterialDecisionDialog analysis={analysis()} topics={topics} onConfirm={onConfirm} onClose={vi.fn()} />)

    expect(screen.getByText('Material analysed')).toBeInTheDocument()
    expect(screen.getByText('lecture-05.pdf')).toBeInTheDocument()
    expect(screen.getByText('BFS')).toBeInTheDocument()
    expect(screen.getByText('Recommended: Graph Algorithms')).toBeInTheDocument()
    expect(screen.getByText(/High relevance · 89%/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Attach to Graph Algorithms' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ decision: 'attach', topicId: 't-graphs' }))
  })

  it('lets the student pick another topic', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<MaterialDecisionDialog analysis={analysis()} topics={topics} onConfirm={onConfirm} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose another topic' }))
    fireEvent.change(screen.getByLabelText('Topic to attach to'), { target: { value: 't-trees' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ decision: 'attach', topicId: 't-trees' }))
    expect(screen.getByRole('option', { name: 'Binary Trees · suggested' })).toBeInTheDocument()
  })

  it('creates a new topic with an editable title when nothing matches', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <MaterialDecisionDialog
        analysis={analysis({
          decision: 'create_new',
          topicId: null,
          topicName: null,
          confidence: 0,
          reason: 'No existing topic covers this material well',
          suggestedTitle: 'Dynamic Programming',
          alternatives: [],
        })}
        topics={topics}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Recommended: create a new topic')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Attach to/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create a new topic' }))
    const title = screen.getByLabelText('New topic title')
    expect(title).toHaveValue('Dynamic Programming')
    fireEvent.change(title, { target: { value: 'DP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ decision: 'create', title: 'DP' }))
  })

  it('shows why a confirmation was refused', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('That topic no longer exists'))
    render(<MaterialDecisionDialog analysis={analysis()} topics={topics} onConfirm={onConfirm} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Attach to Graph Algorithms' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That topic no longer exists')
  })
})
