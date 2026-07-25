'use client'

import { useEffect, useState } from 'react'
import { api, formatDate, post } from '@/lib/api'
import { Badge, Button, Card, Field, Input, Shell } from '@/components/shell'

type Ticket = {
  id: string
  kind: string
  subject: string
  status: string
  externalTransactionId: string | null
  createdAt: string
}

const KIND_LABELS: Record<string, string> = {
  missing_points: 'Missing points',
  payout_issue: 'Payout issue',
  account: 'Account',
  other: 'Something else',
}

const STATUS_TONE: Record<string, string> = {
  open: 'info',
  awaiting_user: 'warn',
  resolved: 'positive',
  closed: 'default',
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [kind, setKind] = useState('missing_points')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [transactionId, setTransactionId] = useState('')
  const [offerName, setOfferName] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api<{ tickets: Ticket[] }>('/me/tickets')
      .then((r) => setTickets(r.tickets))
      .catch(() => {})
  }

  useEffect(load, [])

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
      setNotice('Submitted. We can look up exactly what the network sent us for that transaction.')
      setSubject('')
      setMessage('')
      setTransactionId('')
      setOfferName('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not submit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight">Support</h1>

      <div className="mt-4 grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card title="Open a ticket">
          <form onSubmit={submit} className="space-y-4">
            <Field label="What is this about?">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
              >
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </Field>

            {/* Structured fields, because a missing-points claim with a
                transaction id can be answered from the raw postback log
                instead of a back-and-forth. */}
            {kind === 'missing_points' && (
              <>
                <Field label="Offer name">
                  <Input
                    value={offerName}
                    onChange={(e) => setOfferName(e.target.value)}
                    placeholder="Temu — first order"
                  />
                </Field>
                <Field label="Transaction ID (from the offer, if you have it)">
                  <Input
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    placeholder="Helps us find it instantly"
                  />
                </Field>
              </>
            )}

            <Field label="Details">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                required
                className="w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
              />
            </Field>

            {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}
            {notice && <p className="text-sm text-[var(--color-positive)]">{notice}</p>}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Submitting…' : 'Submit'}
            </Button>
          </form>
        </Card>

        <Card title="Your tickets">
          <div className="space-y-2">
            {tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="flex items-center justify-between rounded-lg border border-[var(--color-line)] px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">{ticket.subject}</div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {KIND_LABELS[ticket.kind] ?? ticket.kind} · {formatDate(ticket.createdAt)}
                    {ticket.externalTransactionId && ` · ${ticket.externalTransactionId}`}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[ticket.status]}>{ticket.status.replace('_', ' ')}</Badge>
              </div>
            ))}

            {tickets.length === 0 && (
              <p className="py-6 text-center text-sm text-[var(--color-muted)]">
                No tickets yet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  )
}
