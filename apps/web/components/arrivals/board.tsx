'use client'

import Link from 'next/link'
import { formatMoney, formatPoints } from '@/lib/api'
import { boardTime, buildBoard, landingSoon, type ArrivalGroup } from '@/lib/arrivals'
import { describeEntry, type Entry } from '@/lib/entries'
import type { Balance } from '../shell'
import { Empty } from '../ui'

/**
 * The board.
 *
 * Rows are grouped by when they land, never by category. The single colour in
 * the whole interface is the status dot and its amount, so the four states a
 * user must tell apart — landed, scheduled, being checked, taken back — are
 * the only things on screen competing for attention.
 */
export function ArrivalsBoard({ balance, entries }: { balance: Balance; entries: Entry[] }) {
  const groups = buildBoard(entries)
  const soon = landingSoon(entries)
  const canCashOut = balance.withdrawable >= balance.minRedemptionPoints

  return (
    <div>
      <Header balance={balance} soon={soon} canCashOut={canCashOut} />

      {groups.length === 0 ? (
        <div className="mt-4 border border-[var(--hairline)]">
          <Empty
            title="Nothing on the board"
            body="Complete an offer or a survey and it appears here with the date it clears."
            action={
              <Link
                href="/earn"
                className="bg-[var(--accent)] px-4 py-2.5 text-[14px] font-semibold text-[var(--accent-ink)]"
              >
                Find something to do
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-7 space-y-7">
          {groups.map((group) => (
            <Group key={group.key} group={group} balance={balance} />
          ))}
        </div>
      )}

      <p className="figure mt-8 border-t border-[var(--hairline)] pt-4 text-[11px] tracking-[0.1em] text-[var(--ink-4)] uppercase">
        Every row shows when it lands · nothing is hidden from this board
      </p>
    </div>
  )
}

function Header({
  balance,
  soon,
  canCashOut,
}: {
  balance: Balance
  soon: { points: number; count: number }
  canCashOut: boolean
}) {
  return (
    <header className="border-b border-[var(--hairline-strong)] pb-6">
      <div className="figure text-[11px] tracking-[0.14em] text-[var(--ink-3)] uppercase">
        Available now
      </div>

      <div className="settle mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="figure text-[clamp(2.5rem,12vw,3.75rem)] leading-none font-semibold tracking-[-0.03em]">
          {formatPoints(balance.withdrawable)}
        </span>
        <span className="figure text-[15px] text-[var(--ink-3)]">
          {formatMoney(balance.withdrawableValueMinor, balance.currency)}
        </span>
      </div>

      {/* The forward-looking line. This is the whole thesis in one sentence. */}
      <p className="mt-3.5 text-[14px] leading-relaxed text-[var(--ink-2)]">
        {soon.count > 0 ? (
          <>
            <span className="figure font-semibold text-[var(--warning)]">
              {formatPoints(soon.points)}
            </span>{' '}
            more lands within a day.
          </>
        ) : balance.onHold > 0 ? (
          <>
            <span className="figure font-semibold text-[var(--warning)]">
              {formatPoints(balance.onHold)}
            </span>{' '}
            still clearing. Every one has a date below.
          </>
        ) : (
          <>Nothing in transit. Everything you have earned is available.</>
        )}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href="/cash-out"
          className={`inline-flex h-11 items-center px-5 text-[15px] font-semibold transition-colors ${
            canCashOut
              ? 'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]'
              : 'border border-[var(--hairline-strong)] text-[var(--ink-3)]'
          }`}
        >
          {canCashOut ? 'Cash out' : `${formatPoints(balance.minRedemptionPoints - balance.withdrawable)} pts to cash out`}
        </Link>

        <span className="figure text-[12px] text-[var(--ink-4)]">
          LEVEL {balance.level.level} · {balance.level.perk}
        </span>
      </div>
    </header>
  )
}

const TONE_COLOR = {
  scheduled: 'var(--warning)',
  landed: 'var(--positive)',
  review: 'var(--info)',
  gone: 'var(--negative)',
} as const

function Group({ group, balance }: { group: ArrivalGroup; balance: Balance }) {
  const color = TONE_COLOR[group.tone]
  const minor = Math.floor(
    (Math.abs(group.total) * balance.minorUnitsPerMajor) / balance.pointsPerUnit,
  )

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] pb-2">
        <div className="flex items-baseline gap-2.5">
          <span
            className="inline-block size-2 shrink-0 translate-y-[-1px]"
            style={{ background: color }}
            aria-hidden
          />
          <h2 className="text-[15px] font-semibold">{group.label}</h2>
          {group.when && (
            <span className="figure text-[11px] tracking-[0.1em] text-[var(--ink-4)]">
              {group.when}
            </span>
          )}
        </div>

        <span className="figure text-[14px] font-semibold" style={{ color }}>
          {group.total > 0 ? '+' : ''}
          {formatPoints(group.total)}
          <span className="ml-1.5 text-[11px] font-normal text-[var(--ink-4)]">
            {formatMoney(minor, balance.currency)}
          </span>
        </span>
      </div>

      <p className="mt-2 text-[12.5px] text-[var(--ink-3)]">{group.note}</p>

      <ul className="mt-3">
        {group.entries.map((entry) => (
          <Row key={entry.id} entry={entry} color={color} />
        ))}
      </ul>
    </section>
  )
}

function Row({ entry, color }: { entry: Entry; color: string }) {
  const described = describeEntry(entry)
  const reversed = entry.type === 'reversal'

  return (
    <li className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2.5 last:border-0">
      {/* The time column. A board reads left to right: when, then what, then
          how much. */}
      <span className="figure w-[42px] shrink-0 text-[12px] text-[var(--ink-4)] tabular-nums">
        {boardTime(entry.status === 'posted' ? entry.availableAt : entry.createdAt)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px]">{described.title}</span>
        {entry.networkName && (
          <span className="figure mt-0.5 block truncate text-[11px] text-[var(--ink-4)]">
            {entry.networkName}
          </span>
        )}
      </span>

      <span
        className={`figure shrink-0 text-[14.5px] font-semibold tabular-nums ${
          reversed ? 'line-through decoration-2' : ''
        }`}
        style={{ color: entry.amountPoints > 0 ? color : 'var(--negative)' }}
      >
        {entry.amountPoints > 0 ? '+' : ''}
        {formatPoints(entry.amountPoints)}
      </span>
    </li>
  )
}
