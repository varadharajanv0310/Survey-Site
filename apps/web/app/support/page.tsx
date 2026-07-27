'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, post } from '@/lib/api'
import { Shell } from '@/components/shell'
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

type Ticket = {
  id: string
  kind: string
  subject: string
  status: string
  externalTransactionId: string | null
  createdAt: string
}

const KINDS = [
  { value: 'missing_points', label: "Points didn't arrive" },
  { value: 'payout_issue', label: 'Payout problem' },
  { value: 'account', label: 'My account' },
  { value: 'other', label: 'Something else' },
] as const

const STATUS_COPY: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: 'OPEN', tone: 'pending' },
  awaiting_user: { label: 'NEEDS YOU', tone: 'pending' },
  resolved: { label: 'RESOLVED', tone: 'positive' },
  closed: { label: 'CLOSED', tone: 'neutral' },
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [kind, setKind] = useState<string>('missing_points')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [transactionId, setTransactionId] = useState('')
  const [offerName, setOfferName] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<{ tickets: Ticket[] }>('/me/tickets')
      .then((r) => setTickets(r.tickets))
      .catch(() => setTickets([]))
  }, [])

  useEffect(load, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await post('/me/tickets', {
        kind,
        subject,
        message,
        externalTransactionId: transactionId || undefined,
        claimedOfferName: offerName || undefined,
      })
      setNotice(
        'Sent. We can look up exactly what the network told us about that transaction, so this is usually quick to answer.',
      )
      setSubject('')
      setMessage('')
      setTransactionId('')
      setOfferName('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <PageHeader title="Help" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Surface as="section" className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">
                What&apos;s wrong?
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setKind(k.value)}
                    aria-pressed={kind === k.value}
                    className={`rounded-[var(--radius-control)] border px-3 py-2.5 text-left text-[13.5px] transition-colors ${
                      kind === k.value
                        ? 'border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]'
                        : 'border-[var(--hairline)] text-[var(--ink-3)] hover:border-[var(--hairline-strong)]'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <Field label="Subject">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Completed Meesho order, no points"
                required
              />
            </Field>

            {/* Structured, because a claim with a transaction id can be answered
                from the raw postback log instead of a week of back-and-forth. */}
            {kind === 'missing_points' && (
              <>
                <Field label="Which offer?">
                  <Input
                    value={offerName}
                    onChange={(e) => setOfferName(e.target.value)}
                    placeholder="Meesho — first order"
                  />
                </Field>
                <Field
                  label="Transaction ID"
                  hint="If the offer gave you one. This lets us find it straight away."
                >
                  <Input
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
              </>
            )}

            <Field label="What happened?">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                required
                placeholder="Tell us what you did and what you expected."
                className="w-full rounded-[var(--radius-control)] border border-[var(--hairline)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] leading-relaxed text-[var(--ink)] transition-colors placeholder:text-[var(--ink-4)] hover:border-[var(--hairline-strong)] focus:border-[var(--accent)] focus:outline-none"
              />
            </Field>

            {error && <Note tone="negative">{error}</Note>}
            {notice && <Note>{notice}</Note>}

            <Button type="submit" loading={busy} className="w-full">
              Send
            </Button>
          </form>
        </Surface>

        <section>
          <h2 className="mb-3 text-[13px] tracking-[0.06em] text-[var(--ink-3)] uppercase">
            Your messages
          </h2>

          {!tickets ? (
            <Skeleton className="h-40 w-full" />
          ) : tickets.length === 0 ? (
            <Surface>
              <Empty
                title="Nothing open"
                body="If points don't show up after completing an offer, tell us here. Networks can take a few hours to confirm, so it's worth waiting a little first."
              />
            </Surface>
          ) : (
            <Surface className="divide-y divide-[var(--hairline)]">
              {tickets.map((ticket) => {
                const copy = STATUS_COPY[ticket.status] ?? {
                  label: ticket.status.toUpperCase(),
                  tone: 'neutral' as StatusTone,
                }
                return (
                  <div key={ticket.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium">{ticket.subject}</div>
                      <div className="figure mt-1 text-[12px] text-[var(--ink-4)]">
                        {new Date(ticket.createdAt).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                        {ticket.externalTransactionId && <> · {ticket.externalTransactionId}</>}
                      </div>
                    </div>
                    <Status tone={copy.tone} label={copy.label} />
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
