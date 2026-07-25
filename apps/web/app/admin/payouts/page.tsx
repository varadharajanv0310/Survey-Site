'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, formatDateTime, formatMoney, formatPoints, post } from '@/lib/api'
import { Badge, Button, Card } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type Payout = {
  id: string
  userId: string
  userEmail: string
  requestedPoints: number
  amountMinor: number
  currency: string
  method: string
  destinationMasked: string
  state: string
  requestedAt: string
  failureReason: string | null
}

const STATES = ['', 'requested', 'under_review', 'approved', 'processing', 'paid', 'failed', 'cancelled']

const STATE_TONE: Record<string, string> = {
  requested: 'info',
  under_review: 'warn',
  approved: 'info',
  processing: 'info',
  paid: 'positive',
  failed: 'negative',
  cancelled: 'default',
}

export default function AdminPayoutsPage() {
  const router = useRouter()
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    api<{ payouts: Payout[] }>(`/admin/payouts${filter ? `?state=${filter}` : ''}`)
      .then((r) => setPayouts(r.payouts))
      .catch(() => router.replace('/admin'))
  }

  useEffect(load, [filter, router])

  const act = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id)
    try {
      if (action === 'reject') {
        const reason = window.prompt('Reason for rejecting (returned to the user as points):')
        if (!reason) return
        await post(`/admin/payouts/${id}/reject`, { reason })
      } else {
        await post(`/admin/payouts/${id}/approve`, {})
      }
      load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminShell>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Payouts</h1>
        <div className="flex gap-1">
          {STATES.map((state) => (
            <button
              key={state || 'all'}
              onClick={() => setFilter(state)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                filter === state
                  ? 'bg-[var(--color-ink)] text-white'
                  : 'text-[var(--color-muted)] hover:bg-slate-200'
              }`}
            >
              {state ? state.replace('_', ' ') : 'all'}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Points were already deducted when the payout was requested. Rejecting returns them as a new
        ledger entry rather than editing the original debit.
      </p>

      <Card className="mt-5">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-5 pb-2 font-medium">User</th>
                <th className="px-5 pb-2 font-medium">Amount</th>
                <th className="px-5 pb-2 font-medium">Method</th>
                <th className="px-5 pb-2 font-medium">Destination</th>
                <th className="px-5 pb-2 font-medium">State</th>
                <th className="px-5 pb-2 font-medium">Requested</th>
                <th className="px-5 pb-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => (
                <tr key={payout.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5">{payout.userEmail}</td>
                  <td className="px-5 py-2.5 font-semibold tabular-nums">
                    {formatMoney(payout.amountMinor, payout.currency)}
                    <span className="ml-1 text-xs font-normal text-[var(--color-muted)]">
                      {formatPoints(payout.requestedPoints)} pts
                    </span>
                  </td>
                  <td className="px-5 py-2.5">{payout.method}</td>
                  <td className="px-5 py-2.5 font-mono text-xs">{payout.destinationMasked}</td>
                  <td className="px-5 py-2.5">
                    <Badge tone={STATE_TONE[payout.state]}>{payout.state.replace('_', ' ')}</Badge>
                    {payout.failureReason && (
                      <div className="mt-0.5 text-xs text-[var(--color-negative)]">
                        {payout.failureReason}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--color-muted)]">
                    {formatDateTime(payout.requestedAt)}
                  </td>
                  <td className="px-5 py-2.5">
                    {['requested', 'under_review'].includes(payout.state) && (
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => act(payout.id, 'approve')}
                          disabled={busy === payout.id}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => act(payout.id, 'reject')}
                          disabled={busy === payout.id}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-[var(--color-muted)]">
                    No payouts in this state.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminShell>
  )
}
