import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MasteryPicker } from './MasteryPicker'

describe('MasteryPicker', () => {
  it('renders all five levels', () => {
    render(<MasteryPicker value={null} onChange={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('reports the level the student picked', () => {
    const onChange = vi.fn()
    render(<MasteryPicker value={null} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /^2 out of 5/ }))

    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('marks the current level as pressed', () => {
    render(<MasteryPicker value={4} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /^4 out of 5/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
