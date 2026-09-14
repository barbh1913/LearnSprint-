import { cn } from '../lib/utils'

/** The LearnSprint wordmark, swapping wordmark colour for light/dark mode
 * (Tailwind's `dark:` variant, driven by the `.dark` class on `<html>`). */
export function Logo({ className }: { className?: string }) {
  return (
    <>
      <img src="/logo-light.png" alt="LearnSprint" className={cn('block dark:hidden', className)} />
      <img src="/logo-dark.png" alt="LearnSprint" className={cn('hidden dark:block', className)} />
    </>
  )
}
