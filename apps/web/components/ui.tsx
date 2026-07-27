'use client'

import { formatMoney, formatPoints } from '@/lib/api'

/* ---------------------------------------------------------------------------
   Primitives shared by both visual worlds.

   Everything here reads from CSS variables, so Tally and Tempo are genuinely
   the same components in two committed worlds rather than two codebases. Where
   a world needs a structurally different treatment (Tempo's frost, Tally's
   hairline), it comes from the token, not from a branch.
   --------------------------------------------------------------------------- */

export function Surface({
  children,
  className = '',
  as: Tag = 'div',
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'article' | 'li' }) {
  return (
    <Tag
      {...rest}
      className={`rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] [box-shadow:var(--elevation)] [backdrop-filter:var(--frost)] ${className}`}
    >
      {children}
    </Tag>
  )
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}) {
  const sizes = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-11 px-4 text-[15px]',
    lg: 'h-13 px-5 text-base',
  }[size]

  const variants = {
    primary:
      'bg-[var(--accent)] text-[var(--accent-ink)] font-semibold hover:bg-[var(--accent-hover)] active:brightness-95',
    quiet:
      'bg-[var(--surface-2)] text-[var(--ink)] border border-[var(--hairline)] hover:border-[var(--hairline-strong)]',
    ghost: 'text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--surface)]',
    danger: 'bg-[var(--negative)] text-white font-semibold hover:brightness-110',
  }[variant]

  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] transition-[background-color,border-color,color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${sizes} ${variants} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  )
}

/* --- money -----------------------------------------------------------------

   The user's answer: points lead, rupees underneath. Both are rendered by one
   component so the hierarchy can never drift between screens.

   ---------------------------------------------------------------------------- */

export function Amount({
  points,
  minor,
  currency = 'INR',
  size = 'md',
  signed = false,
  tone,
}: {
  points: number
  minor?: number
  currency?: string
  size?: 'sm' | 'md' | 'lg' | 'hero'
  signed?: boolean
  tone?: 'positive' | 'negative' | 'muted'
}) {
  const sizes = {
    sm: { p: 'text-[15px]', c: 'text-[11px]' },
    md: { p: 'text-xl', c: 'text-xs' },
    lg: { p: 'text-3xl', c: 'text-sm' },
    hero: { p: 'text-[clamp(2.75rem,12vw,4rem)]', c: 'text-base' },
  }[size]

  const color =
    tone === 'positive'
      ? 'text-[var(--positive)]'
      : tone === 'negative'
        ? 'text-[var(--negative)]'
        : tone === 'muted'
          ? 'text-[var(--ink-3)]'
          : 'text-[var(--ink)]'

  const sign = signed && points > 0 ? '+' : ''

  return (
    <span className="inline-flex flex-col items-end leading-none">
      <span className={`figure font-semibold ${sizes.p} ${color}`}>
        {sign}
        {formatPoints(points)}
        <span className="ml-1 text-[0.55em] font-medium text-[var(--ink-3)]">pts</span>
      </span>
      {minor !== undefined && (
        <span className={`figure mt-1.5 ${sizes.c} text-[var(--ink-3)]`}>
          ≈ {formatMoney(minor, currency)}
        </span>
      )}
    </span>
  )
}

/* --- status ----------------------------------------------------------------

   Tally's thesis is that every state carries a plain-language reason. That is
   the whole trust argument, so the reason is a required prop rather than an
   optional one — a status with no explanation cannot be rendered.

   ---------------------------------------------------------------------------- */

export type StatusTone = 'positive' | 'pending' | 'negative' | 'neutral'

export function Status({ tone, label }: { tone: StatusTone; label: string }) {
  const colors = {
    positive: 'text-[var(--positive)]',
    pending: 'text-[var(--warning)]',
    negative: 'text-[var(--negative)]',
    neutral: 'text-[var(--ink-3)]',
  }[tone]

  return (
    <span className={`figure text-[12px] tracking-[0.04em] uppercase ${colors}`}>{label}</span>
  )
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: StatusTone | 'accent'
}) {
  const styles = {
    positive: 'text-[var(--positive)] bg-[color-mix(in_srgb,var(--positive)_14%,transparent)]',
    pending: 'text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)]',
    negative: 'text-[var(--negative)] bg-[color-mix(in_srgb,var(--negative)_14%,transparent)]',
    neutral: 'text-[var(--ink-2)] bg-[var(--surface-2)]',
    accent: 'text-[var(--accent)] bg-[var(--accent-wash)]',
  }[tone]

  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] px-2 py-1 text-[11px] font-medium tracking-[0.02em] ${styles}`}
    >
      {children}
    </span>
  )
}

/* --- form ------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-medium text-[var(--ink-2)]">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-[13px] text-[var(--negative)]">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-[var(--ink-3)]">{hint}</span>
      ) : null}
    </label>
  )
}

export function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-11 w-full rounded-[var(--radius-control)] border border-[var(--hairline)] bg-[var(--surface)] px-3.5 text-[15px] text-[var(--ink)] transition-colors placeholder:text-[var(--ink-4)] hover:border-[var(--hairline-strong)] focus:border-[var(--accent)] focus:outline-none ${className}`}
    />
  )
}

/* --- structure -------------------------------------------------------------- */

export function PageHeader({
  title,
  meta,
  action,
}: {
  title: string
  meta?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="display text-2xl font-semibold sm:text-3xl">{title}</h1>
        {meta && <div className="mt-1.5 text-[13px] text-[var(--ink-3)]">{meta}</div>}
      </div>
      {action}
    </div>
  )
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="display text-lg font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-[46ch] text-[14px] leading-relaxed text-[var(--ink-3)]">
        {body}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

/**
 * Titled panel. Used heavily by the admin surface, which is Operate mode and
 * wants labelled containers rather than the user app's looser composition.
 */
export function Card({
  title,
  subtitle,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Surface as="section" className={`p-5 ${className}`}>
      {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
      {subtitle && <p className="mt-1 text-[12.5px] text-[var(--ink-3)]">{subtitle}</p>}
      <div className={title ? 'mt-4' : ''}>{children}</div>
    </Surface>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'muted' | 'warn' | 'positive' | 'negative'
}) {
  const color = {
    default: 'text-[var(--ink)]',
    muted: 'text-[var(--ink-3)]',
    warn: 'text-[var(--warning)]',
    positive: 'text-[var(--positive)]',
    negative: 'text-[var(--negative)]',
  }[tone]

  return (
    <div>
      <div className="text-[11px] tracking-[0.08em] text-[var(--ink-3)] uppercase">{label}</div>
      <div className={`figure mt-1.5 text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-[12px] text-[var(--ink-4)]">{hint}</div>}
    </div>
  )
}

/** Legacy alias. `Pill` is the name to use in new code. */
export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  const map: Record<string, StatusTone | 'accent'> = {
    default: 'neutral',
    positive: 'positive',
    negative: 'negative',
    warn: 'pending',
    info: 'accent',
  }
  return <Pill tone={map[tone] ?? 'neutral'}>{children}</Pill>
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-control)] bg-[var(--surface-2)] ${className}`}
    />
  )
}

/**
 * A note the user needs to believe. Used for the hold explanation and the
 * reversal explanation — the two places where being unclear costs trust.
 *
 * Deliberately not a left-border callout: that is the category default, and
 * the floor is right that it reads as decoration. A tinted surface with a
 * hairline carries the same emphasis without the stripe.
 */
export function Note({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warning' | 'negative'
  children: React.ReactNode
}) {
  const styles = {
    neutral: 'border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink-2)]',
    warning:
      'border-[color-mix(in_srgb,var(--warning)_32%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-[var(--ink)]',
    negative:
      'border-[color-mix(in_srgb,var(--negative)_32%,transparent)] bg-[color-mix(in_srgb,var(--negative)_10%,transparent)] text-[var(--ink)]',
  }[tone]

  return (
    <div
      className={`rounded-[var(--radius-card)] border px-4 py-3.5 text-[13.5px] leading-relaxed ${styles}`}
    >
      {children}
    </div>
  )
}
