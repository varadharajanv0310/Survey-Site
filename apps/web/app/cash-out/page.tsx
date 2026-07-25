'use client'

import { useEffect, useState } from 'react'
import { api, formatDate, formatMoney, formatPoints, post } from '@/lib/api'
import { Badge, Button, Card, Field, Input, Shell } from '@/components/shell'

type Balance = {
  withdrawable: number
  minRedemptionPoints: number
  estimatedValueMinor: number
  withdrawableValueMinor: number
  currency: string
  minorUnitsPerMajor: number
  /** Sent by the API so the client never hardcodes the conversion rate. */
  pointsPerUnit: number
}

type Payout = {
  id: string
  requestedPoints: number
  amountMinor: number
  currency: string
  method: string
  destinationMasked: string
  state: string
  requestedAt: string
  settledAt: string | null
  failureReason: string | null
}

const STATE_TONE: Record<string, string> = {
  requested: 'info',
  under_review: 'warn',
  approved: 'info',
  processing: 'info',
  paid: 'positive',
  failed: 'negative',
  cancelled: 'default',
}

const STATE_LABEL: Record<string, string> = {
  requested: 'Requested',
  under_review: 'Under review',
  approved: 'Approved',
  processing: 'Sending',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

// UPI first: it is how this audience actually expects to be paid.
const METHODS = [
  { value: 'upi', label: 'UPI', placeholder: 'you@okhdfcbank' },
  { value: 'giftcard', label: 'Gift card', placeholder: 'you@example.com' },
  { value: 'paypal', label: 'PayPal', placeholder: 'you@example.com' },
] as const

export default function CashOutPage() {
  const [balance, setBalance] = useState<Balance | null>(null)
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('upi')
  const [destination, setDestination] = useState('')
  const [points, setPoints] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api<Balance>('/me/balance').then(setBalance).catch(() => {})
    api<{ payouts: Payout[] }>('/me/payouts')
      .then((r) => setPayouts(r.payouts))
      .catch(() => {})
  }

  useEffect(load, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await post<{ state: string }>('/me/payouts', {
        points: Number(points),
        method,
        destination,
      })
      setNotice(
        result.state === 'under_review'
          ? 'Requested. This one is going through a manual check first — most clear within a day.'
          : 'Requested. You will see it move to Paid once the provider settles.',
      )
      setPoints('')
      setDestination('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not request payout')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: string) => {
    try {
      await post(`/me/payouts/${id}/cancel`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not cancel')
    }
  }

  const selected = METHODS.find((m) => m.value === method)!
  const canAfford = balance ? Number(points) <= balance.withdrawable : false

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight">Cash out</h1>

      <div className="mt-4 grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card title="Request a payout">
          {balance && (
            <p className="-mt-2 mb-4 text-sm text-[var(--color-muted)]">
              You have{' '}
              <strong className="font-semibold text-[var(--color-ink)]">
                {formatPoints(balance.withdrawable)} points
              </strong>{' '}
              available ({formatMoney(balance.withdrawableValueMinor, balance.currency)}). Minimum{' '}
              {formatPoints(balance.minRedemptionPoints)} points (
              {formatMoney(
                Math.floor(
                  (balance.minRedemptionPoints * balance.minorUnitsPerMajor) / balance.pointsPerUnit,
                ),
                balance.currency,
              )}
              ).
            </p>
          )}

          <form onSubmit={submit} className="space-y-4">
            <Field label="Method">
              <div className="flex gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                      method === m.value
                        ? 'border-[var(--color-brand)] bg-indigo-50 text-[var(--color-brand)]'
                        : 'border-[var(--color-line)] bg-white text-[var(--color-muted)]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={method === 'upi' ? 'UPI ID' : 'Email address'}>
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={selected.placeholder}
                required
              />
            </Field>

            <Field label="Points">
              <Input
                type="number"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                min={balance?.minRedemptionPoints ?? 500}
                max={balance?.withdrawable ?? undefined}
                required
              />
            </Field>

            {points && balance && (
              <p className="text-xs text-[var(--color-muted)]">
                You will receive{' '}
                <strong className="text-[var(--color-ink)]">
                  {formatMoney(
                    Math.floor(
                      (Number(points) * balance.minorUnitsPerMajor) / balance.pointsPerUnit,
                    ),
                    balance.currency,
                  )}
                </strong>
                .
              </p>
            )}

            {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}
            {notice && <p className="text-sm text-[var(--color-positive)]">{notice}</p>}

            <Button type="submit" disabled={busy || !canAfford} className="w-full">
              {busy ? 'Requesting…' : 'Request payout'}
            </Button>

            <p className="text-xs leading-relaxed text-[var(--color-muted)]">
              Points are deducted as soon as you request. If a payout is cancelled or fails, they
              are returned to your balance in full.
            </p>
          </form>
        </Card>

        <Card title="Your payouts">
          <div className="space-y-2">
            {payouts.map((payout) => (
              <div
                key={payout.id}
                className="flex items-center gap-4 rounded-lg border border-[var(--color-line)] px-4 py-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      {formatMoney(payout.amountMinor, payout.currency)}
                    </span>
                    <Badge tone={STATE_TONE[payout.state]}>
                      {STATE_LABEL[payout.state] ?? payout.state}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {formatPoints(payout.requestedPoints)} pts · {payout.method} ·{' '}
                    {payout.destinationMasked} · {formatDate(payout.requestedAt)}
                  </div>
                  {payout.failureReason && (
                    <div className="mt-1 text-xs text-[var(--color-negative)]">
                      {payout.failureReason}
                    </div>
                  )}
                </div>

                {['requested', 'under_review'].includes(payout.state) && (
                  <Button variant="ghost" onClick={() => cancel(payout.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            ))}

            {payouts.length === 0 && (
              <p className="py-6 text-center text-sm text-[var(--color-muted)]">
                No payouts yet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  )
}
