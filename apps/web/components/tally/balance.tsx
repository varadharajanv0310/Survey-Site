'use client'

import Link from 'next/link'
import { formatMoney, formatPoints } from '@/lib/api'
import type { Balance } from '../shell'
import { Amount, Note, Status, Surface } from '../ui'
import type { Entry } from '@/lib/entries'
import { describeEntry } from '@/lib/entries'

/**
 * Tally's balance screen. Money in an account.
 *
 * The available figure is the largest thing on the page and everything else is
 * subordinate to it. Clearing and under-review sit beside it as facts rather
 * than as warnings, because hiding them is what makes them feel like a trick
 * when the user finds out.
 */
export function TallyBalance({
  balance,
  entries,
  month,
}: {
  balance: Balance
  entries: Entry[]
  month: { total: number; days: { day: number; points: number }[]; best: { day: number; points: number } | null }
}) {
  return (
    <div className="space-y-5">
      <section>
        <div className="text-[13px] text-[var(--ink-3)]">Available to cash out</div>
        <div className="settle mt-2 flex items-baseline gap-2">
          <span className="figure text-[clamp(2.75rem,13vw,4.25rem)] leading-none font-semibold">
            {formatPoints(balance.withdrawable)}
          </span>
          <span className="text-lg font-medium text-[var(--ink-3)]">pts</span>
        </div>
        <div className="figure mt-2 text-[15px] text-[var(--ink-2)]">
          {formatMoney(balance.withdrawableValueMinor, balance.currency)}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Surface className="p-4">
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[var(--warning)]" aria-hidden />
            <span className="text-[12px] text-[var(--ink-3)]">Clearing</span>
          </div>
          <div className="figure mt-2 text-xl font-semibold">{formatPoints(balance.onHold)}</div>
          <div className="figure mt-0.5 text-[11px] text-[var(--ink-4)]">
            {formatMoney(
              Math.floor((balance.onHold * balance.minorUnitsPerMajor) / balance.pointsPerUnit),
              balance.currency,
            )}
          </div>
        </Surface>

        <Surface className="p-4">
          <div className="flex items-center gap-1.5">
            <span
              className={`size-1.5 rounded-full ${balance.pending > 0 ? 'bg-[var(--info)]' : 'bg-[var(--ink-4)]'}`}
              aria-hidden
            />
            <span className="text-[12px] text-[var(--ink-3)]">Under review</span>
          </div>
          <div className="figure mt-2 text-xl font-semibold">{formatPoints(balance.pending)}</div>
          <div className="figure mt-0.5 text-[11px] text-[var(--ink-4)]">
            {balance.pending > 0 ? 'Being checked' : 'Nothing held'}
          </div>
        </Surface>
      </div>

      {balance.onHold > 0 && (
        <Note tone="warning">
          <strong className="font-semibold">
            {formatPoints(balance.onHold)} points are still clearing.
          </strong>{' '}
          Networks can take a completion back for a few days after crediting it, so points wait out
          that window before they can be withdrawn. Nothing is being held from you.
        </Note>
      )}

      {/* Earned this month. A real chart of real days — not a sparkline
          standing in for content. */}
      <Surface className="p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-medium">Earned this month</h2>
          <Amount points={month.total} size="sm" tone="positive" signed />
        </div>

        {month.days.length > 0 ? (
          <>
            <div className="mt-5 flex h-24 items-end gap-[3px]" role="img" aria-label={`Daily earnings, ${month.total} points this month`}>
              {month.days.map((d) => {
                const max = Math.max(...month.days.map((x) => x.points), 1)
                const pct = (d.points / max) * 100
                const isBest = month.best?.day === d.day && d.points > 0
                return (
                  <div
                    key={d.day}
                    title={`${d.day} — ${formatPoints(d.points)} pts`}
                    className={`flex-1 rounded-t-[2px] transition-colors ${
                      isBest ? 'bg-[var(--accent)]' : 'bg-[var(--accent-dim)]/45'
                    }`}
                    style={{ height: `${Math.max(pct, d.points > 0 ? 6 : 2)}%` }}
                  />
                )
              })}
            </div>
            <p className="figure mt-3 text-[12px] text-[var(--ink-3)]">
              {entries.length} entries
              {month.best && month.best.points > 0 && (
                <> · best day {month.best.day}, {formatPoints(month.best.points)} pts</>
              )}
            </p>
          </>
        ) : (
          <p className="mt-4 text-[14px] text-[var(--ink-3)]">
            Nothing yet this month. Completed offers appear here the day they credit.
          </p>
        )}
      </Surface>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] tracking-[0.06em] text-[var(--ink-3)] uppercase">Recent</h2>
          <Link href="/statement" className="text-[14px] font-medium text-[var(--accent)]">
            Statement
          </Link>
        </div>

        <Surface className="divide-y divide-[var(--hairline)]">
          {entries.slice(0, 6).map((entry) => {
            const d = describeEntry(entry)
            return (
              <div key={entry.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{d.title}</div>
                  <div className="mt-1">
                    <Status tone={d.tone} label={d.status} />
                  </div>
                </div>
                <Amount
                  points={entry.amountPoints}
                  size="sm"
                  signed
                  tone={entry.amountPoints > 0 ? 'positive' : 'negative'}
                />
              </div>
            )
          })}

          {entries.length === 0 && (
            <p className="px-4 py-8 text-center text-[14px] text-[var(--ink-3)]">
              No activity yet.
            </p>
          )}
        </Surface>
      </section>
    </div>
  )
}
