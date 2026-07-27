'use client'

import { useEffect, useMemo, useState } from 'react'
import { api, formatMoney, formatPoints } from '@/lib/api'
import { describeEntry, type Entry } from '@/lib/entries'
import { Shell, type Balance } from '@/components/shell'
import { Amount, Empty, PageHeader, Skeleton, Status, Surface } from '@/components/ui'

type Filter = 'all' | 'earned' | 'clearing' | 'review' | 'taken_back' | 'cashed_out'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'earned', label: 'Earned' },
  { key: 'clearing', label: 'Clearing' },
  { key: 'review', label: 'In review' },
  { key: 'taken_back', label: 'Taken back' },
  { key: 'cashed_out', label: 'Cashed out' },
]

function bucketOf(entry: Entry): Filter {
  if (entry.status === 'pending') return 'review'
  if (entry.type === 'reversal') return 'taken_back'
  if (entry.type === 'redeem') return 'cashed_out'
  if (entry.status === 'posted' && new Date(entry.availableAt) > new Date()) return 'clearing'
  return 'earned'
}

/**
 * The statement. Every row carries its reason, in words, with a date.
 *
 * On desktop this is a real table because that is what makes a hundred rows
 * scannable. On mobile it becomes rows of stacked facts rather than a table
 * squeezed into 360px, which is unreadable at any font size worth shipping.
 */
export default function StatementPage() {
  const [balance, setBalance] = useState<Balance | null>(null)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    api<Balance>('/me/balance').then(setBalance).catch(() => {})
    api<{ entries: Entry[] }>('/me/history?limit=200')
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]))
  }, [])

  const totals = useMemo(() => {
    const list = entries ?? []
    return {
      earned: list.filter((e) => e.amountPoints > 0 && e.status === 'posted').reduce((s, e) => s + e.amountPoints, 0),
      takenBack: list.filter((e) => e.type === 'reversal').reduce((s, e) => s + Math.abs(e.amountPoints), 0),
      cashedOut: list.filter((e) => e.type === 'redeem').reduce((s, e) => s + Math.abs(e.amountPoints), 0),
    }
  }, [entries])

  const visible = (entries ?? []).filter((e) => filter === 'all' || bucketOf(e) === filter)

  if (!entries || !balance) {
    return (
      <Shell>
        <Skeleton className="mb-6 h-9 w-44" />
        <Skeleton className="h-96 w-full" />
      </Shell>
    )
  }

  return (
    <Shell>
      <PageHeader
        title="Statement"
        meta={
          <span className="figure">
            {entries.length} entries · {formatPoints(totals.earned)} pts earned
          </span>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Earned" value={totals.earned} tone="positive" balance={balance} />
        <Stat label="Available" value={balance.withdrawable} balance={balance} />
        <Stat label="Clearing" value={balance.onHold} tone="warning" balance={balance} />
        <Stat label="Taken back" value={-totals.takenBack} tone="negative" balance={balance} />
      </div>

      {/* Horizontal scroll on the filter row rather than wrapping to two lines,
          which would push the table below the fold on a phone. */}
      <div className="-mx-5 mb-4 flex gap-1.5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-[var(--radius-pill)] px-3 py-1.5 text-[13px] transition-colors ${
              filter === f.key
                ? 'bg-[var(--accent)] font-semibold text-[var(--accent-ink)]'
                : 'border border-[var(--hairline)] text-[var(--ink-3)] hover:text-[var(--ink)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Surface>
          <Empty
            title="Nothing here"
            body={
              filter === 'all'
                ? 'Completed offers and surveys appear here the moment a network confirms them.'
                : 'No entries match this filter. Try “All”.'
            }
          />
        </Surface>
      ) : (
        <>
          {/* Desktop: the six-column statement. */}
          <Surface className="hidden overflow-hidden lg:block">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-[var(--hairline)] text-left">
                  {['Activity', 'Source', 'Date', 'Status', 'Points'].map((h, i) => (
                    <th
                      key={h}
                      className={`px-5 py-3 text-[11px] font-medium tracking-[0.08em] text-[var(--ink-3)] uppercase ${
                        i === 4 ? 'text-right' : ''
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {visible.map((entry) => {
                  const d = describeEntry(entry)
                  return (
                    <tr key={entry.id} className="transition-colors hover:bg-[var(--surface)]">
                      <td className="px-5 py-3.5">
                        <div className="font-medium">{d.title}</div>
                        {d.detail && (
                          <div className="mt-0.5 text-[12.5px] text-[var(--ink-3)]">{d.detail}</div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[var(--ink-3)]">
                        {entry.networkName ?? '—'}
                      </td>
                      <td className="figure px-5 py-3.5 text-[13px] whitespace-nowrap text-[var(--ink-3)]">
                        {new Date(entry.createdAt)
                          .toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                          .toUpperCase()}
                      </td>
                      <td className="px-5 py-3.5">
                        <Status tone={d.tone} label={d.status} />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span
                          className={`figure font-semibold ${
                            entry.amountPoints > 0
                              ? 'text-[var(--positive)]'
                              : 'text-[var(--negative)]'
                          } ${entry.type === 'reversal' ? 'line-through decoration-2' : ''}`}
                        >
                          {entry.amountPoints > 0 ? '+' : ''}
                          {formatPoints(entry.amountPoints)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Surface>

          {/* Mobile: the same facts, stacked. */}
          <Surface className="divide-y divide-[var(--hairline)] lg:hidden">
            {visible.map((entry) => {
              const d = describeEntry(entry)
              return (
                <div key={entry.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium">{d.title}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <Status tone={d.tone} label={d.status} />
                        {entry.networkName && (
                          <span className="truncate text-[12px] text-[var(--ink-4)]">
                            {entry.networkName}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`figure shrink-0 font-semibold ${
                        entry.amountPoints > 0
                          ? 'text-[var(--positive)]'
                          : 'text-[var(--negative)]'
                      } ${entry.type === 'reversal' ? 'line-through decoration-2' : ''}`}
                    >
                      {entry.amountPoints > 0 ? '+' : ''}
                      {formatPoints(entry.amountPoints)}
                    </span>
                  </div>
                  {d.detail && (
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-3)]">
                      {d.detail}
                    </p>
                  )}
                </div>
              )
            })}
          </Surface>
        </>
      )}

      <p className="figure mt-5 text-[11.5px] tracking-[0.04em] text-[var(--ink-4)] uppercase">
        Every hold and reversal is explained on its own row
      </p>
    </Shell>
  )
}

function Stat({
  label,
  value,
  tone,
  balance,
}: {
  label: string
  value: number
  tone?: 'positive' | 'warning' | 'negative'
  balance: Balance
}) {
  const color =
    tone === 'positive'
      ? 'text-[var(--positive)]'
      : tone === 'warning'
        ? 'text-[var(--warning)]'
        : tone === 'negative'
          ? 'text-[var(--negative)]'
          : 'text-[var(--ink)]'

  const minor = Math.floor((Math.abs(value) * balance.minorUnitsPerMajor) / balance.pointsPerUnit)

  return (
    <Surface className="p-4">
      <div className="text-[12px] text-[var(--ink-3)]">{label}</div>
      <div className={`figure mt-1.5 text-xl font-semibold ${color}`}>
        {value < 0 ? '−' : ''}
        {formatPoints(Math.abs(value))}
      </div>
      <div className="figure mt-0.5 text-[11px] text-[var(--ink-4)]">
        {formatMoney(minor, balance.currency)}
      </div>
    </Surface>
  )
}
