'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api, formatMoney, formatPoints, post } from '@/lib/api'

type Balance = {
  posted: number
  withdrawable: number
  onHold: number
  pending: number
  estimatedValueMinor: number
  currency: string
  minRedemptionPoints: number
}

const NAV = [
  { href: '/earn', label: 'Earn' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/cash-out', label: 'Cash out' },
  { href: '/referrals', label: 'Refer' },
  { href: '/support', label: 'Support' },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [balance, setBalance] = useState<Balance | null>(null)
  const [email, setEmail] = useState<string>('')

  useEffect(() => {
    api<{ user: { email: string } }>('/auth/me')
      .then((r) => setEmail(r.user.email))
      .catch(() => router.replace('/login'))
    api<Balance>('/me/balance').then(setBalance).catch(() => {})
  }, [router])

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
          <Link href="/earn" className="text-lg font-semibold tracking-tight">
            Rewards
          </Link>

          <nav className="flex flex-1 gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  pathname === item.href
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'text-[var(--color-muted)] hover:bg-slate-100'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {balance && (
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums">
                {formatPoints(balance.posted)} pts
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                ≈ {formatMoney(balance.estimatedValueMinor, balance.currency)}
              </div>
            </div>
          )}

          <button
            onClick={async () => {
              await post('/auth/logout')
              router.replace('/login')
            }}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            title={email}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  )
}

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
    <section
      className={`rounded-xl border border-[var(--color-line)] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      {subtitle && <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>}
      <div className={title ? 'mt-4' : ''}>{children}</div>
    </section>
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
  tone?: 'default' | 'muted' | 'warn'
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-[var(--color-warn)]'
      : tone === 'muted'
        ? 'text-[var(--color-muted)]'
        : 'text-[var(--color-ink)]'
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-[var(--color-muted)]">{hint}</div>}
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base =
    'inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed'
  const styles = {
    primary: 'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)]',
    ghost: 'border border-[var(--color-line)] bg-white hover:bg-slate-50',
    danger: 'bg-[var(--color-negative)] text-white hover:bg-red-700',
  }[variant]
  return (
    <button {...props} className={`${base} ${styles} ${props.className ?? ''}`}>
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    default: 'bg-slate-100 text-slate-700',
    positive: 'bg-emerald-50 text-emerald-700',
    negative: 'bg-red-50 text-red-700',
    warn: 'bg-amber-50 text-amber-700',
    info: 'bg-indigo-50 text-indigo-700',
  }
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone] ?? tones.default}`}
    >
      {children}
    </span>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)] ${props.className ?? ''}`}
    />
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{label}</span>
      {children}
    </label>
  )
}
