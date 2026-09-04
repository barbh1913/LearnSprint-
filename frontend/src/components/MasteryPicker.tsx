// 1-5 mastery rating (FR2.4). Lower ratings earn more review time in the
// generated schedule, so this control is what actually steers the algorithm.

import type { MasteryLevel } from '../types'
import { cn } from '../lib/utils'

const LEVELS: MasteryLevel[] = [1, 2, 3, 4, 5]

const LEVEL_HINTS: Record<MasteryLevel, string> = {
  1: 'Barely started',
  2: 'Shaky',
  3: 'Getting there',
  4: 'Comfortable',
  5: 'Could teach it',
}

export function MasteryPicker({
  value,
  onChange,
}: {
  value: MasteryLevel | null
  onChange: (level: MasteryLevel) => void
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Mastery level">
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => onChange(level)}
          title={LEVEL_HINTS[level]}
          aria-label={`${level} out of 5 - ${LEVEL_HINTS[level]}`}
          aria-pressed={value === level}
          className={cn(
            'size-7 rounded-md border text-xs font-medium transition-colors',
            value === level
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border hover:border-primary hover:text-primary',
          )}
        >
          {level}
        </button>
      ))}
    </div>
  )
}
