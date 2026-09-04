// Small shared building blocks. Keeping them here rather than repeating Tailwind
// strings across pages is what keeps the styling consistent.

import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', className)}>{children}</div>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        variant === 'primary' && 'bg-primary text-primary-foreground hover:opacity-90',
        variant === 'secondary' && 'border border-border bg-card hover:bg-muted',
        variant === 'ghost' && 'hover:bg-muted',
        variant === 'danger' && 'border border-border text-red-600 hover:bg-red-50 dark:hover:bg-red-950',
        className,
      )}
      {...props}
    />
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

const inputStyles =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputStyles, props.className)} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputStyles, props.className)} />
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warning' | 'success' | 'danger'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        tone === 'accent' && 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
        tone === 'warning' && 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
        tone === 'success' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        tone === 'danger' && 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <span className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
      {label}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {message}
    </div>
  )
}

/** Horizontal completion bar. Used for topic progress and course progress. */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
    </div>
  )
}
