'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, formatDateTime, formatMoney, formatPoints, post } from '@/lib/api'
import { Badge, Button, Card, Field, Input, Stat } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type Detail = {
  user: {
    id: string
    email: string
    status: string
    statusReason: string | null
    country: string | null
    referralCode: string
    emailVerifiedAt: string | null
    signupIp: string | null
    createdAt: string
  }
  balance: {
    posted: number
    withdrawable: number
    onHold: number
    pending: number
    lifetimeEarned: number
  }
  entries: {
    id: string
    amountPoints: number
    type: string
    status: string
    note: string | null
    externalTransactionId: string | null
    createdAt: string
    networkName: string | null
  }[]
  payouts: {
    id: string
    requestedPoints: number
    amountMinor: number
    currency: string
    state: string
    destinationMasked: string
    requestedAt: string
  }[]
}

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [data, setData] = useState<Detail | null>(null)
  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [message, setMessage] = useState('')

  const load = () => {
    api<Detail>(`/admin/users/${id}`)
      .then(setData)
      .catch(() => router.replace('/admin'))
  }

  useEffect(load, [id, router])

  const adjust = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await post(`/admin/users/${id}/adjust`, {
        points: Number(adjustPoints),
        reason: adjustReason,
        // Client-generated, so a double-submitted form adjusts once.
        clientUuid: crypto.randomUUID(),
      })
      setMessage('Adjustment recorded as a new ledger entry.')
      setAdjustPoints('')
      setAdjustReason('')
      load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'failed')
    }
  }

  const setStatus = async (status: string) => {
    const reason = window.prompt(`Reason for setting status to ${status}:`)
    if (!reason) return
    await post(`/admin/users/${id}/status`, { status, reason })
    load()
  }

  if (!data) return <AdminShell><p className="text-sm">Loading…</p></AdminShell>

  return (
    <AdminShell>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{data.user.email}</h1>
          <div className="mt-1 flex items-center gap-3 text-xs text-[var(--color-muted)]">
            <Badge
              tone={
                data.user.status === 'active'
                  ? 'positive'
                  : data.user.status === 'banned'
                    ? 'negative'
                    : 'warn'
              }
            >
              {data.user.status}
            </Badge>
            <span>{data.user.country ?? 'unknown country'}</span>
            <span>code {data.user.referralCode}</span>
            <span>signup IP {data.user.signupIp ?? '—'}</span>
            {!data.user.emailVerifiedAt && (
              <span className="text-[var(--color-warn)]">email unverified</span>
            )}
          </div>
          {data.user.statusReason && (
            <p className="mt-1 text-xs text-[var(--color-negative)]">{data.user.statusReason}</p>
          )}
        </div>

        <div className="flex gap-2">
          {data.user.status !== 'active' && (
            <Button variant="ghost" onClick={() => setStatus('active')}>
              Reactivate
            </Button>
          )}
          {data.user.status === 'active' && (
            <>
              <Button variant="ghost" onClick={() => setStatus('suspended')}>
                Suspend
              </Button>
              <Button variant="danger" onClick={() => setStatus('banned')}>
                Ban
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-5">
        <Card><Stat label="Balance" value={formatPoints(data.balance.posted)} /></Card>
        <Card><Stat label="Available" value={formatPoints(data.balance.withdrawable)} /></Card>
        <Card><Stat label="On hold" value={formatPoints(data.balance.onHold)} tone="warn" /></Card>
        <Card><Stat label="Under review" value={formatPoints(data.balance.pending)} tone="warn" /></Card>
        <Card><Stat label="Lifetime" value={formatPoints(data.balance.lifetimeEarned)} tone="muted" /></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Ledger" subtitle="Append-only. Adjustments add rows; nothing is ever edited.">
          <div className="-mx-5 max-h-[520px] overflow-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  <th className="px-5 pb-2 font-medium">When</th>
                  <th className="px-5 pb-2 font-medium">Type</th>
                  <th className="px-5 pb-2 font-medium">Reference</th>
                  <th className="px-5 pb-2 font-medium">Status</th>
                  <th className="px-5 pb-2 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2 whitespace-nowrap text-xs text-[var(--color-muted)]">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-5 py-2">
                      {entry.type}
                      {entry.note && (
                        <div className="text-xs text-[var(--color-muted)]">{entry.note}</div>
                      )}
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-[var(--color-muted)]">
                      {entry.externalTransactionId ?? entry.networkName ?? '—'}
                    </td>
                    <td className="px-5 py-2">
                      <Badge
                        tone={
                          entry.status === 'posted'
                            ? 'positive'
                            : entry.status === 'pending'
                              ? 'warn'
                              : 'negative'
                        }
                      >
                        {entry.status}
                      </Badge>
                    </td>
                    <td
                      className={`px-5 py-2 text-right font-semibold tabular-nums ${
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
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Manual adjustment">
            <form onSubmit={adjust} className="space-y-3">
              <Field label="Points (negative to deduct)">
                <Input
                  type="number"
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value)}
                  required
                />
              </Field>
              <Field label="Reason (recorded in the audit log)">
                <Input
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  required
                  minLength={3}
                />
              </Field>
              {message && <p className="text-xs text-[var(--color-muted)]">{message}</p>}
              <Button type="submit" className="w-full">
                Apply adjustment
              </Button>
            </form>
          </Card>

          <Card title="Payouts">
            <div className="space-y-2">
              {data.payouts.map((payout) => (
                <div key={payout.id} className="rounded-lg border border-[var(--color-line)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold tabular-nums">
                      {formatMoney(payout.amountMinor, payout.currency)}
                    </span>
                    <Badge tone={payout.state === 'paid' ? 'positive' : 'default'}>
                      {payout.state.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {payout.destinationMasked} · {formatDateTime(payout.requestedAt)}
                  </div>
                </div>
              ))}
              {data.payouts.length === 0 && (
                <p className="py-3 text-center text-sm text-[var(--color-muted)]">None</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </AdminShell>
  )
}
