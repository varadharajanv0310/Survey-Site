'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api, formatMoney, formatPoints } from '@/lib/api'
import {
  THEMES,
  applyTheme,
  currentTheme,
  pinnedTheme,
  syncThemeAcrossTabs,
  type ThemeName,
} from '@/lib/theme'
import { Skeleton } from './ui'

// Re-exported so existing screens and the whole admin surface keep importing
// their primitives from one place while the tokens moved underneath them.
export { Badge, Button, Card, Field, Input, Pill, Stat, Surface } from './ui'

export type Balance = {
  posted: number
  withdrawable: number
  onHold: number
  pending: number
  lifetimeEarned: number
  estimatedValueMinor: number
  withdrawableValueMinor: number
  currency: string
  minorUnitsPerMajor: number
  pointsPerUnit: number
  /** Already discounted by the user's level. This is what the API enforces. */
  minRedemptionPoints: number
  baseMinRedemptionPoints: number
  level: {
    level: number
    name: string
    perk: string
    progress: number
    toNext: number
    nextName: string | null
    nextPerk: string | null
  }
}

/**
 * One information architecture, two vocabularies.
 *
 * The routes are identical because the product is identical; only the words
 * change. Tally calls the money screen a Balance and the history a Statement,
 * because it is presenting an account. Tempo calls them Wallet and Activity,
 * because it is presenting a week.
 */
const NAV: { href: string; tally: string; tempo: string; arrivals: string; icon: React.ReactNode }[] =
  [
    { href: '/earn', tally: 'Earn', tempo: 'Earn', arrivals: 'Earn', icon: <IconEarn /> },
    { href: '/wallet', tally: 'Balance', tempo: 'Wallet', arrivals: 'Board', icon: <IconBalance /> },
    {
      href: '/statement',
      tally: 'Statement',
      tempo: 'Activity',
      arrivals: 'History',
      icon: <IconStatement />,
    },
    { href: '/you', tally: 'You', tempo: 'You', arrivals: 'You', icon: <IconYou /> },
  ]

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [theme, setTheme] = useState<ThemeName>('tally')
  const [balance, setBalance] = useState<Balance | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setTheme(currentTheme())

    // Follow the attribute, not storage — see the note in lib/theme.ts.
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const stopSync = syncThemeAcrossTabs()

    api<{ user: { email: string } }>('/auth/me')
      .then(() => setReady(true))
      .catch(() => router.replace('/login'))
    api<Balance>('/me/balance')
      .then(setBalance)
      .catch(() => {})

    return () => {
      observer.disconnect()
      stopSync()
    }
  }, [router])

  const switchTheme = (next: ThemeName) => {
    applyTheme(next)
    setTheme(next)
  }

  const label = (item: (typeof NAV)[number]) => item[theme]

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop rail. Both directions put navigation on the left and keep the
          money permanently in view at the bottom — that is the promise. */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-[var(--hairline)] px-5 py-6 lg:flex">
        <Wordmark theme={theme} />

        <nav className="mt-9 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-[15px] transition-colors ${
                  active
                    ? 'bg-[var(--surface-2)] font-medium text-[var(--ink)]'
                    : 'text-[var(--ink-3)] hover:bg-[var(--surface)] hover:text-[var(--ink-2)]'
                }`}
              >
                <span className="opacity-80">{item.icon}</span>
                {label(item)}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto space-y-4">
          <ThemeSwitch theme={theme} onChange={switchTheme} />
          <BalanceCard balance={balance} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar. Carries the wordmark and the live balance, so the
            number is never more than a glance away. */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] px-5 py-3 [backdrop-filter:blur(16px)] lg:hidden">
          <Wordmark theme={theme} />
          {balance ? (
            <div className="text-right leading-tight">
              <div className="figure text-[15px] font-semibold">
                {formatPoints(balance.posted)}
                <span className="ml-1 text-[10px] font-medium text-[var(--ink-3)]">pts</span>
              </div>
              <div className="figure text-[11px] text-[var(--ink-3)]">
                ≈ {formatMoney(balance.estimatedValueMinor, balance.currency)}
              </div>
            </div>
          ) : (
            <Skeleton className="h-8 w-24" />
          )}
        </header>

        <main
          className="mx-auto w-full max-w-5xl flex-1 px-5 py-6 pb-28 lg:px-10 lg:py-10 lg:pb-10"
          style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}
        >
          {ready ? children : <ShellSkeleton />}
        </main>

        {/* Mobile tab bar. Four destinations, because five does not survive a
            360px viewport with legible labels. */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[var(--hairline)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] [backdrop-filter:blur(20px)] lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1.5 py-3 text-[11px] transition-colors ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--ink-3)]'
                }`}
              >
                {item.icon}
                <span className={active ? 'font-semibold' : ''}>{label(item)}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

function Wordmark({ theme }: { theme: ThemeName }) {
  return (
    <Link href="/earn" className="inline-flex items-baseline gap-2">
      <span className="figure text-[13px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">
        {THEMES.find((t) => t.name === theme)?.label ?? 'Arrivals'}
      </span>
    </Link>
  )
}

/**
 * Visible on purpose, not hidden in settings. These are two candidate products
 * and the point of shipping both is that they can be compared in seconds on a
 * real device with real data.
 */
function ThemeSwitch({
  theme,
  onChange,
}: {
  theme: ThemeName
  onChange: (t: ThemeName) => void
}) {
  /**
   * Resolved after mount, not during render.
   *
   * `pinnedTheme()` reads `window.location.search`, which is null on the
   * server and populated on the client, so rendering it directly made the
   * server emit "Direction" and the client "Direction · pinned" — a hydration
   * mismatch that React reported on every page of every theme.
   */
  const [pinned, setPinned] = useState(false)
  useEffect(() => setPinned(pinnedTheme() !== null), [])

  return (
    <div>
      <div className="mb-2 text-[11px] tracking-[0.08em] text-[var(--ink-4)] uppercase">
        Direction{pinned && ' · pinned'}
      </div>
      <div
        role="radiogroup"
        aria-label="Visual direction"
        className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] border border-[var(--hairline)] p-1"
      >
        {THEMES.map((t) => (
          <button
            key={t.name}
            role="radio"
            aria-checked={theme === t.name}
            title={t.thesis}
            onClick={() => onChange(t.name)}
            className={`rounded-[calc(var(--radius-control)-4px)] py-1.5 text-[13px] transition-colors ${
              theme === t.name
                ? 'bg-[var(--accent)] font-semibold text-[var(--accent-ink)]'
                : 'text-[var(--ink-3)] hover:text-[var(--ink)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function BalanceCard({ balance }: { balance: Balance | null }) {
  if (!balance) return <Skeleton className="h-28 w-full" />

  const canCashOut = balance.withdrawable >= balance.minRedemptionPoints

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4 [backdrop-filter:var(--frost)]">
      <div className="text-[11px] tracking-[0.08em] text-[var(--ink-3)] uppercase">Available</div>
      <div className="figure mt-1.5 text-2xl font-semibold">
        {formatPoints(balance.withdrawable)}
      </div>
      <div className="figure mt-0.5 text-[12px] text-[var(--ink-3)]">
        ≈ {formatMoney(balance.withdrawableValueMinor, balance.currency)}
      </div>
      <Link
        href="/cash-out"
        className={`mt-3 flex h-10 items-center justify-center rounded-[var(--radius-control)] text-[14px] font-semibold transition-colors ${
          canCashOut
            ? 'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]'
            : 'border border-[var(--hairline)] text-[var(--ink-3)]'
        }`}
      >
        {canCashOut
          ? 'Cash out'
          : `${formatPoints(balance.minRedemptionPoints - balance.withdrawable)} to go`}
      </Link>
    </div>
  )
}

function ShellSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-40" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

/* --- icons -----------------------------------------------------------------
   Drawn at 20px on a 24 grid, 1.6 stroke, so they hold at tab-bar size on a
   360px screen without turning to mush.
   --------------------------------------------------------------------------- */

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function IconEarn() {
  return (
    <svg {...iconProps}>
      <path d="M12 3v18M8 7h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7" />
    </svg>
  )
}

function IconBalance() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M16.5 14.5h1.5" />
    </svg>
  )
}

function IconStatement() {
  return (
    <svg {...iconProps}>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 11h8M8 15h5" />
    </svg>
  )
}

function IconYou() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  )
}
