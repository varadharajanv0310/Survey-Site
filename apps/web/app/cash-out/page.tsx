'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, formatMoney, formatPoints, post } from '@/lib/api'
import { Shell, type Balance } from '@/components/shell'
import {
  Button,
  Empty,
  Field,
  Input,
  Note,
  PageHeader,
  Skeleton,
  Status,
  Surface,
  type StatusTone,
} from '@/components/ui'

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

/** UPI first: it is how this audience actually expects to be paid. */
const METHODS = [
  { value: 'upi', label: 'UPI', field: 'UPI ID', placeholder: 'you@okhdfcbank' },
  { value: 'giftcard', label: 'Gift card', field: 'Email address', placeholder: 'you@example.com' },
  { value: 'paypal', label: 'PayPal', field: 'PayPal email', placeholder: 'you@example.com' },
] as const

/**
 * Payout states in the user's language, each with what it means for them.
 * A bare "processing" tells someone nothing about whether to worry.
 */
const STATE_COPY: Record<string, { label: string; tone: StatusTone; detail: string }> = {
  requested: {
    label: 'REQUESTED',
    tone: 'pending',
    detail: 'Queued to be sent. Nothing needed from you.',
  },
  under_review: {
    label: 'IN REVIEW',
    tone: 'pending',
    detail: 'A person is checking this one. Most clear within a day.',
  },
  approved: { label: 'APPROVED', tone: 'pending', detail: 'Cleared to send.' },
  processing: {
    label: 'SENDING',
    tone: 'pending',
    detail: 'With the payment provider now. UPI usually lands within a few hours.',
  },
  paid: { label: 'PAID', tone: 'positive', detail: 'Sent. Check the account you gave us.' },
  failed: {
    label: 'FAILED',
    tone: 'negative',
    detail: 'The transfer did not go through. Your points were returned in full.',
  },
  cancelled: {
    label: 'CANCELLED',
    tone: 'neutral',
    detail: 'Cancelled. Your points were returned in full.',
  },
}

export default function CashOutPage() {
  const [balance, setBalance] = useState<Balance | null>(null)
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [method, setMethod] = useState<(typeof METHODS)[number]['value']>('upi')
  const [destination, setDestination] = useState('')
  const [points, setPoints] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<Balance>('/me/balance').then(setBalance).catch(() => {})
    api<{ payouts: Payout[] }>('/me/payouts')
      .then((r) => setPayouts(r.payouts))
      .catch(() => {})
  }, [])

  useEffect(load, [load])

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
          ? 'Requested. This one goes through a manual check first — most clear within a day.'
          : 'Requested. You will see it move to Paid once the provider settles.',
      )
      setPoints('')
      setDestination('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a payout')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: string) => {
    try {
      await post(`/me/payouts/${id}/cancel`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel')
    }
  }

  if (!balance) {
    return (
      <Shell>
        <Skeleton className="mb-6 h-9 w-36" />
        <Skeleton className="h-80 w-full" />
      </Shell>
    )
  }

  const selected = METHODS.find((m) => m.value === method)!
  const requested = Number(points) || 0
  const short = balance.minRedemptionPoints - balance.withdrawable
  const canRequest =
    requested >= balance.minRedemptionPoints &&
    requested <= balance.withdrawable &&
    destination.trim().length > 2

  const payable = Math.floor((requested * balance.minorUnitsPerMajor) / balance.pointsPerUnit)
  const minimumMinor = Math.floor(
    (balance.minRedemptionPoints * balance.minorUnitsPerMajor) / balance.pointsPerUnit,
  )

  return (
    <Shell>
      <PageHeader title="Cash out" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-4">
          <Surface className="p-5">
            <div className="text-[13px] text-[var(--ink-3)]">Available</div>
            <div className="figure mt-1.5 text-3xl font-semibold">
              {formatPoints(balance.withdrawable)}
              <span className="ml-1.5 text-base font-medium text-[var(--ink-3)]">pts</span>
            </div>
            <div className="figure mt-1 text-[14px] text-[var(--ink-2)]">
              {formatMoney(balance.withdrawableValueMinor, balance.currency)}
            </div>

            <p className="mt-3 text-[13px] text-[var(--ink-3)]">
              Minimum <span className="figure">{formatPoints(balance.minRedemptionPoints)}</span>{' '}
              points ({formatMoney(minimumMinor, balance.currency)})
              {balance.minRedemptionPoints < balance.baseMinRedemptionPoints && (
                <span className="text-[var(--accent)]">
                  {' '}
                  — lowered by your level
                </span>
              )}
              .
            </p>
          </Surface>

          {short > 0 ? (
            <Surface>
              <Empty
                title={`${formatPoints(short)} points to go`}
                body="Complete an offer or a survey and this unlocks. Points still clearing will count once their hold passes."
              />
            </Surface>
          ) : (
            <Surface as="section" className="p-5">
              <form onSubmit={submit} className="space-y-4">
                <fieldset>
                  <legend className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">
                    Where should it go?
                  </legend>
                  <div className="grid grid-cols-3 gap-2">
                    {METHODS.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMethod(m.value)}
                        aria-pressed={method === m.value}
                        className={`rounded-[var(--radius-control)] border py-2.5 text-[13.5px] font-medium transition-colors ${
                          method === m.value
                            ? 'border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]'
                            : 'border-[var(--hairline)] text-[var(--ink-3)] hover:border-[var(--hairline-strong)]'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <Field label={selected.field}>
                  <Input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={selected.placeholder}
                    inputMode={method === 'upi' ? 'text' : 'email'}
                    autoComplete="off"
                    required
                  />
                </Field>

                <Field
                  label="How many points?"
                  hint={
                    requested > 0
                      ? `You receive ${formatMoney(payable, balance.currency)}`
                      : undefined
                  }
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    min={balance.minRedemptionPoints}
                    max={balance.withdrawable}
                    placeholder={String(balance.minRedemptionPoints)}
                    required
                  />
                </Field>

                <button
                  type="button"
                  onClick={() => setPoints(String(balance.withdrawable))}
                  className="text-[13px] font-medium text-[var(--accent)]"
                >
                  Use everything available
                </button>

                {error && <Note tone="negative">{error}</Note>}
                {notice && <Note>{notice}</Note>}

                <Button type="submit" loading={busy} disabled={!canRequest} className="w-full">
                  Request payout
                </Button>

                <p className="text-[12.5px] leading-relaxed text-[var(--ink-3)]">
                  Points come out of your balance as soon as you request, not when the money lands.
                  If a payout is cancelled or fails they are returned in full.
                </p>
              </form>
            </Surface>
          )}
        </div>

        <section>
          <h2 className="mb-3 text-[13px] tracking-[0.06em] text-[var(--ink-3)] uppercase">
            Your payouts
          </h2>

          {payouts.length === 0 ? (
            <Surface>
              <Empty title="No payouts yet" body="Your first one will show up here with its status and the date it was sent." />
            </Surface>
          ) : (
            <Surface className="divide-y divide-[var(--hairline)]">
              {payouts.map((payout) => {
                const copy = STATE_COPY[payout.state] ?? {
                  label: payout.state.toUpperCase(),
                  tone: 'neutral' as StatusTone,
                  detail: '',
                }
                return (
                  <div key={payout.id} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="figure text-[17px] font-semibold">
                          {formatMoney(payout.amountMinor, payout.currency)}
                        </div>
                        <div className="figure mt-0.5 text-[12px] text-[var(--ink-3)]">
                          {formatPoints(payout.requestedPoints)} pts · {payout.method} ·{' '}
                          {payout.destinationMasked}
                        </div>
                      </div>
                      <Status tone={copy.tone} label={copy.label} />
                    </div>

                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-3)]">
                      {payout.failureReason ?? copy.detail}
                    </p>

                    {['requested', 'under_review'].includes(payout.state) && (
                      <Button
                        variant="quiet"
                        size="sm"
                        className="mt-3"
                        onClick={() => cancel(payout.id)}
                      >
                        Cancel and return points
                      </Button>
                    )}
                  </div>
                )
              })}
            </Surface>
          )}
        </section>
      </div>
    </Shell>
  )
}
