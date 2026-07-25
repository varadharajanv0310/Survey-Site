'use client'

import { useEffect, useState } from 'react'
import { api, formatDateTime, formatMoney, formatPoints } from '@/lib/api'
import { Badge, Card, Shell, Stat } from '@/components/shell'

type Balance = {
  posted: number
  withdrawable: number
  onHold: number
  pending: number
  lifetimeEarned: number
  estimatedValueMinor: number
  withdrawableValueMinor: number
  currency: string
  minRedemptionPoints: number
}

type Entry = {
  id: string
  amountPoints: number
  type: string
  status: string
  availableAt: string
  note: string | null
  createdAt: string
  networkName: string | null
}

const TYPE_LABELS: Record<string, string> = {
  earn: 'Offer completed',
  screenout: 'Survey screenout',
  reversal: 'Reversed by network',
  redeem: 'Cash out',
  redeem_refund: 'Cash out refunded',
  manual_adjustment: 'Manual adjustment',
  bonus: 'Daily bonus',
  referral_bonus: 'Referral bonus',
  referral_commission: 'Referral commission',
}

export default function WalletPage() {
  const [balance, setBalance] = useState<Balance | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])

  useEffect(() => {
    api<Balance>('/me/balance').then(setBalance).catch(() => {})
    api<{ entries: Entry[] }>('/me/history?limit=100')
      .then((r) => setEntries(r.entries))
      .catch(() => {})
  }, [])

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight">Wallet</h1>

      {balance && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <Stat
                label="Balance"
                value={`${formatPoints(balance.posted)} pts`}
                hint={`≈ ${formatMoney(balance.estimatedValueMinor, balance.currency)}`}
              />
            </Card>
            <Card>
              <Stat
                label="Available to cash out"
                value={`${formatPoints(balance.withdrawable)} pts`}
                hint={`${formatMoney(balance.withdrawableValueMinor, balance.currency)} · minimum ${formatPoints(balance.minRedemptionPoints)} pts`}
              />
            </Card>
            <Card>
              <Stat
                label="On hold"
                value={`${formatPoints(balance.onHold)} pts`}
                hint="Clears once the network confirms"
                tone={balance.onHold > 0 ? 'warn' : 'muted'}
              />
            </Card>
            <Card>
              <Stat
                label="Under review"
                value={`${formatPoints(balance.pending)} pts`}
                hint="Being checked before crediting"
                tone={balance.pending > 0 ? 'warn' : 'muted'}
              />
            </Card>
          </div>

          {/* Explaining the hold up front is cheaper than answering the ticket
              it generates. */}
          {balance.onHold > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong className="font-semibold">
                {formatPoints(balance.onHold)} points are still clearing.
              </strong>{' '}
              Networks can reverse a completion for a few days after crediting it, so recently
              earned points become available to cash out once that window passes.
            </div>
          )}
        </>
      )}

      <Card title="Transaction history" className="mt-6">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-5 pb-2 font-medium">Date</th>
                <th className="px-5 pb-2 font-medium">Activity</th>
                <th className="px-5 pb-2 font-medium">Source</th>
                <th className="px-5 pb-2 font-medium">Status</th>
                <th className="px-5 pb-2 text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 whitespace-nowrap text-xs text-[var(--color-muted)]">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="px-5 py-2.5">
                    <div>{TYPE_LABELS[entry.type] ?? entry.type}</div>
                    {entry.note && (
                      <div className="text-xs text-[var(--color-muted)]">{entry.note}</div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--color-muted)]">
                    {entry.networkName ?? '—'}
                  </td>
                  <td className="px-5 py-2.5">
                    {entry.status === 'pending' ? (
                      <Badge tone="warn">Under review</Badge>
                    ) : entry.status === 'rejected' ? (
                      <Badge tone="negative">Rejected</Badge>
                    ) : new Date(entry.availableAt) > new Date() ? (
                      <Badge tone="warn">Clearing</Badge>
                    ) : (
                      <Badge tone="positive">Cleared</Badge>
                    )}
                  </td>
                  <td
                    className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
                      entry.amountPoints > 0
                        ? 'text-[var(--color-positive)]'
                        : 'text-[var(--color-negative)]'
                    }`}
                  >
                    {entry.amountPoints > 0 ? '+' : ''}
                    {formatPoints(entry.amountPoints)}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-[var(--color-muted)]">
                    Nothing here yet. Complete an offer to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  )
}
