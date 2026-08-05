'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api, formatPoints, post } from '@/lib/api'
import { THEMES, applyTheme, currentTheme, type ThemeName } from '@/lib/theme'
import { Shell, type Balance } from '@/components/shell'
import { Button, Note, PageHeader, Pill, Skeleton, Surface } from '@/components/ui'

type User = {
  email: string
  country: string | null
  referralCode: string
  emailVerifiedAt: string | null
  createdAt: string
}

/**
 * The fourth tab in both directions. A hub, not a settings dump — the things a
 * user comes here for are their level, their referral link, and getting help.
 */
export default function YouPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [balance, setBalance] = useState<Balance | null>(null)
  const [theme, setTheme] = useState<ThemeName>('tally')
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    setTheme(currentTheme())
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    api<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(() => {})
    api<Balance>('/me/balance').then(setBalance).catch(() => {})

    return () => observer.disconnect()
  }, [])

  const switchTheme = (next: ThemeName) => {
    applyTheme(next)
    setTheme(next)
  }

  if (!user || !balance) {
    return (
      <Shell>
        <Skeleton className="mb-6 h-9 w-28" />
        <Skeleton className="h-64 w-full" />
      </Shell>
    )
  }

  return (
    <Shell>
      <PageHeader title="You" meta={user.email} />

      <div className="space-y-4">
        {!user.emailVerifiedAt && (
          <Note tone="warning">
            <strong className="font-semibold">Confirm your email to cash out.</strong> We sent a
            link when you signed up. Cashing out is blocked until it&apos;s confirmed — it&apos;s
            how we keep one person from running many accounts.
            <div className="mt-3">
              <Button
                size="sm"
                variant="quiet"
                loading={resending}
                disabled={resent}
                onClick={async () => {
                  setResending(true)
                  await post('/auth/password-reset/request', { email: user.email }).catch(() => {})
                  setResending(false)
                  setResent(true)
                }}
              >
                {resent ? 'Sent' : 'Resend link'}
              </Button>
            </div>
          </Note>
        )}

        {/* Level. Real, and the perks named here are enforced on the server. */}
        <Surface className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold">Level {balance.level.level}</h2>
                <Pill tone="accent">{balance.level.name}</Pill>
              </div>
              <p className="mt-1.5 text-[13.5px] text-[var(--ink-2)]">{balance.level.perk}</p>
            </div>
            <div className="text-right">
              <div className="figure text-[13px] text-[var(--ink-3)]">
                {formatPoints(balance.lifetimeEarned)}
              </div>
              <div className="text-[11px] text-[var(--ink-4)]">lifetime</div>
            </div>
          </div>

          {balance.level.nextName && (
            <>
              <div
                className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
                role="progressbar"
                aria-valuenow={Math.round(balance.level.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-700"
                  style={{ width: `${Math.max(2, balance.level.progress * 100)}%` }}
                />
              </div>
              <p className="mt-2.5 text-[13px] text-[var(--ink-3)]">
                <span className="figure">{formatPoints(balance.level.toNext)}</span> points to{' '}
                {balance.level.nextName} — {balance.level.nextPerk?.toLowerCase()}
              </p>
            </>
          )}

          <p className="mt-3 text-[12.5px] text-[var(--ink-4)]">
            Levels shorten how long points take to clear and lower your cash-out minimum. They
            never change how much an offer pays.
          </p>
        </Surface>

        <div className="grid gap-3 sm:grid-cols-2">
          <LinkCard
            href="/referrals"
            title="Refer a friend"
            body={`Your code is ${user.referralCode}. You earn when they do, out of our share.`}
          />
          <LinkCard
            href="/support"
            title="Get help"
            body="Missing points, payout trouble, or anything else. Include the transaction id if you have it."
          />
          <LinkCard
            href="/cash-out"
            title="Cash out"
            body={`Minimum ${formatPoints(balance.minRedemptionPoints)} points at your level.`}
          />
          <LinkCard
            href="/statement"
            title="Full statement"
            body="Every credit, hold and reversal, with the reason for each."
          />
        </div>

        <Surface className="p-5">
          <h2 className="text-[15px] font-semibold">Visual direction</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-3)]">
            Two candidate designs, same data. Switch freely — nothing about your account changes.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {THEMES.map((t) => (
              <button
                key={t.name}
                onClick={() => switchTheme(t.name)}
                aria-pressed={theme === t.name}
                className={`rounded-[var(--radius-control)] border p-4 text-left transition-colors ${
                  theme === t.name
                    ? 'border-[var(--accent)] bg-[var(--accent-wash)]'
                    : 'border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold">{t.label}</span>
                  {theme === t.name && <Pill tone="accent">Active</Pill>}
                </div>
                <p className="mt-1 text-[12.5px] text-[var(--ink-3)]">{t.thesis}</p>
              </button>
            ))}
          </div>
        </Surface>

        <div className="flex flex-wrap items-center gap-4 pt-2 text-[13px] text-[var(--ink-3)]">
          <Link href="/legal/privacy" className="hover:text-[var(--ink)]">
            Privacy
          </Link>
          <Link href="/legal/terms" className="hover:text-[var(--ink)]">
            Terms
          </Link>
          <button
            onClick={async () => {
              await post('/auth/logout')
              router.replace('/login')
            }}
            className="ml-auto text-[var(--ink-3)] hover:text-[var(--negative)]"
          >
            Sign out
          </button>
        </div>
      </div>
    </Shell>
  )
}

function LinkCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4 transition-colors [backdrop-filter:var(--frost)] hover:border-[var(--accent)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[var(--ink-4)]" aria-hidden>
          →
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-3)]">{body}</p>
    </Link>
  )
}
