'use client'

import Link from 'next/link'
import { formatMoney, formatPoints } from '@/lib/api'
import type { Balance } from '../shell'
import { Button, Surface } from '../ui'

export type WeeklyState = {
  earned: number
  target: number
  streak: number
  claimedToday: boolean
}

/**
 * Tempo's home. The week, not the account.
 *
 * Tempo's original mechanic was a weekly *spend* target, which does not exist
 * here — nobody spends anything. The honest translation is a weekly *earnings*
 * target: the same "am I on pace" question, asked about the thing our users
 * actually control.
 *
 * The level badge is real. It reads from lifetime points and the perks it
 * names are enforced server-side, so the ring and the badge are both reporting
 * facts rather than decorating the screen.
 */
export function TempoHome({
  balance,
  weekly,
  onClaim,
  claiming,
}: {
  balance: Balance
  weekly: WeeklyState
  onClaim: () => void
  claiming: boolean
}) {
  const pct = weekly.target > 0 ? Math.min(1, weekly.earned / weekly.target) : 0
  const onPace = pct >= 0.7
  const remaining = Math.max(0, weekly.target - weekly.earned)
  const canCashOut = balance.withdrawable >= balance.minRedemptionPoints

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--hairline)] bg-[var(--surface)] px-3 py-1.5 [backdrop-filter:var(--frost)]">
          <span className="text-[13px] font-semibold">Level {balance.level.level}</span>
          <span className="text-[13px] text-[var(--accent)]">{balance.level.name}</span>
        </div>
        <span className="text-[12px] text-[var(--ink-3)]">{balance.level.perk}</span>
      </div>

      <Surface className="p-6">
        <PaceRing earned={weekly.earned} target={weekly.target} onPace={onPace} />

        <p className="mt-5 text-center text-[13.5px] text-[var(--ink-2)]">
          {remaining > 0 ? (
            <>
              <strong className="font-semibold text-[var(--ink)]">
                {formatPoints(remaining)} points
              </strong>{' '}
              to hit this week&apos;s target.
            </>
          ) : (
            <>Target hit. Anything more this week is ahead of pace.</>
          )}
        </p>
      </Surface>

      {/* Streak. Real data from the daily bonus, which is the only thing in the
          product with an actual consecutive-day mechanic. */}
      <Surface className="p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">
            {weekly.streak} day{weekly.streak === 1 ? '' : 's'} in a row
          </h2>
          <span className="text-[12px] text-[var(--ink-3)]">
            {weekly.claimedToday ? 'Claimed today' : 'Not claimed yet'}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          {Array.from({ length: 7 }, (_, i) => {
            const day = i + 1
            const done = day <= weekly.streak
            const today = day === weekly.streak + (weekly.claimedToday ? 0 : 1)
            return (
              <div
                key={day}
                className={`flex h-9 flex-1 items-center justify-center rounded-[var(--radius-control)] text-[12px] font-semibold ${
                  done
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : today
                      ? 'border border-dashed border-[var(--accent)] text-[var(--accent)]'
                      : 'bg-[var(--surface-2)] text-[var(--ink-4)]'
                }`}
              >
                {done ? day : today ? 'NOW' : day}
              </div>
            )
          })}
        </div>

        {!weekly.claimedToday && (
          <Button onClick={onClaim} loading={claiming} className="mt-4 w-full">
            Claim today&apos;s bonus
          </Button>
        )}
      </Surface>

      {/* Level progress. Named perks only, because a progress bar toward an
          unstated reward is a bar toward nothing. */}
      {balance.level.nextName && (
        <Surface className="p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Next: {balance.level.nextName}</h2>
            <span className="figure text-[12px] text-[var(--ink-3)]">
              {formatPoints(balance.level.toNext)} pts to go
            </span>
          </div>

          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
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

          <p className="mt-2.5 text-[13px] text-[var(--ink-2)]">{balance.level.nextPerk}</p>
        </Surface>
      )}

      <Surface className="flex items-center justify-between gap-4 p-5">
        <div>
          <div className="text-[12px] text-[var(--ink-3)]">
            {canCashOut ? 'Ready to cash out' : 'Keep going'}
          </div>
          <div className="figure mt-1 text-xl font-semibold">
            {formatPoints(balance.withdrawable)}
            <span className="ml-1.5 text-[13px] font-medium text-[var(--ink-3)]">
              ≈ {formatMoney(balance.withdrawableValueMinor, balance.currency)}
            </span>
          </div>
        </div>

        {canCashOut ? (
          <Link href="/cash-out">
            <Button>Cash out</Button>
          </Link>
        ) : (
          <span className="figure text-right text-[12px] text-[var(--ink-3)]">
            {formatPoints(balance.minRedemptionPoints - balance.withdrawable)}
            <br />
            to go
          </span>
        )}
      </Surface>
    </div>
  )
}

/**
 * The pace ring. Progress toward the weekly target, with the number in the
 * middle — the ring is the content, not a decorative arc behind a stat.
 */
function PaceRing({
  earned,
  target,
  onPace,
}: {
  earned: number
  target: number
  onPace: boolean
}) {
  const size = 220
  const stroke = 14
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = target > 0 ? Math.min(1, earned / target) : 0
  const offset = circumference * (1 - pct)

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        role="img"
        aria-label={`${formatPoints(earned)} of ${formatPoints(target)} points this week`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={onPace ? 'var(--accent)' : 'var(--warning)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="sweep"
          style={{ ['--sweep-from' as string]: `${circumference}` }}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="figure text-[2.5rem] leading-none font-semibold">
          {formatPoints(earned)}
        </span>
        <span className="mt-1.5 text-[13px] text-[var(--ink-3)]">
          of {formatPoints(target)} this week
        </span>
        <span
          className={`mt-2 text-[12px] font-semibold tracking-[0.08em] uppercase ${
            onPace ? 'text-[var(--accent)]' : 'text-[var(--warning)]'
          }`}
        >
          {onPace ? 'On pace' : 'Behind'}
        </span>
      </div>
    </div>
  )
}
