'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, formatDateTime, formatPoints, post } from '@/lib/api'
import { Badge, Button, Card } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type Detail = {
  ticket: {
    id: string
    userId: string
    userEmail: string
    userStatus: string
    kind: string
    subject: string
    status: string
    networkName: string | null
    externalTransactionId: string | null
    claimedOfferName: string | null
    completedAt: string | null
    createdAt: string
  }
  messages: {
    id: string
    body: string
    isInternal: boolean
    authorUserId: string | null
    authorAdminId: string | null
    createdAt: string
  }[]
  balance: { posted: number; withdrawable: number; onHold: number; pending: number }
  evidence: {
    verdict: string
    postbackEvents: Record<string, unknown>[]
    completions: Record<string, unknown>[]
    ledgerEntries: Record<string, unknown>[]
  } | null
  recentClicks: { offerTitle: string | null; externalOfferId: string | null; createdAt: string }[]
}

/**
 * The four outcomes a missing-points claim can have, and what each one means
 * for the reply. This is the whole reason the click log and the raw postback
 * log exist.
 */
const VERDICTS: Record<string, { tone: string; label: string; meaning: string }> = {
  credited: {
    tone: 'positive',
    label: 'Already credited',
    meaning: 'The points are on the account. Point the user at the entry, or check for a reversal.',
  },
  received_but_not_credited: {
    tone: 'warn',
    label: 'Received, not credited',
    meaning: 'We got the event and held or rejected it. Check the fraud review queue — this may be ours to fix.',
  },
  postback_received_but_rejected: {
    tone: 'negative',
    label: 'Postback rejected',
    meaning: 'The network sent something we refused: bad signature or malformed. Likely our integration, not the user.',
  },
  no_postback_ever_received: {
    tone: 'default',
    label: 'Nothing received',
    meaning: 'The network never told us. If they clicked, raise it with the network. If they never clicked, they did not start it.',
  },
}

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [data, setData] = useState<Detail | null>(null)
  const [message, setMessage] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api<Detail>(`/admin/tickets/${id}`)
      .then((d) => {
        setData(d)
        setStatus(d.ticket.status)
      })
      .catch(() => router.replace('/admin'))
  }

  useEffect(load, [id, router])

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await post(`/admin/tickets/${id}/reply`, {
        message,
        isInternal,
        status: status || undefined,
      })
      setMessage('')
      load()
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <AdminShell><p className="text-sm">Loading…</p></AdminShell>

  const { ticket, messages, balance, evidence, recentClicks } = data
  const verdict = evidence ? VERDICTS[evidence.verdict] : null

  return (
    <AdminShell>
      <button
        onClick={() => router.push('/admin/tickets')}
        className="text-sm font-medium text-[var(--color-brand)]"
      >
        ← Support queue
      </button>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
          <div className="mt-1 flex items-center gap-3 text-xs text-[var(--color-muted)]">
            <button
              onClick={() => router.push(`/admin/users/${ticket.userId}`)}
              className="font-medium text-[var(--color-brand)]"
            >
              {ticket.userEmail}
            </button>
            <span>{formatDateTime(ticket.createdAt)}</span>
            <span>
              balance {formatPoints(balance.posted)} pts
              {balance.pending > 0 && ` · ${formatPoints(balance.pending)} under review`}
            </span>
          </div>
        </div>
        <Badge tone={ticket.status === 'resolved' ? 'positive' : 'info'}>
          {ticket.status.replace('_', ' ')}
        </Badge>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card title="Conversation">
            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg px-4 py-3 text-sm ${
                    m.isInternal
                      ? 'border border-dashed border-amber-300 bg-amber-50'
                      : m.authorAdminId
                        ? 'bg-indigo-50'
                        : 'bg-slate-100'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                    <span className="font-medium">
                      {m.authorAdminId ? 'Support' : ticket.userEmail}
                    </span>
                    {m.isInternal && <Badge tone="warn">internal note</Badge>}
                    <span>{formatDateTime(m.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>

            <form onSubmit={send} className="mt-5 space-y-3 border-t border-[var(--color-line)] pt-4">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                required
                placeholder={isInternal ? 'Internal note — the user never sees this' : 'Reply to the user…'}
                className="w-full rounded-md border border-[var(--color-line)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
              />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                  />
                  Internal note
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="rounded-md border border-[var(--color-line)] px-2 py-1.5 text-sm"
                >
                  <option value="open">open</option>
                  <option value="awaiting_user">awaiting user</option>
                  <option value="resolved">resolved</option>
                  <option value="closed">closed</option>
                </select>
                <Button type="submit" disabled={busy} className="ml-auto">
                  {busy ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          {ticket.externalTransactionId && verdict && (
            <Card title="What the network actually sent">
              <Badge tone={verdict.tone}>{verdict.label}</Badge>
              <p className="mt-2 text-sm text-[var(--color-muted)]">{verdict.meaning}</p>

              <dl className="mt-4 space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-[var(--color-muted)]">Transaction</dt>
                  <dd className="font-mono">{ticket.externalTransactionId}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--color-muted)]">Raw postbacks</dt>
                  <dd className="tabular-nums">{evidence!.postbackEvents.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--color-muted)]">Completions</dt>
                  <dd className="tabular-nums">{evidence!.completions.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--color-muted)]">Ledger entries</dt>
                  <dd className="tabular-nums">{evidence!.ledgerEntries.length}</dd>
                </div>
              </dl>

              {evidence!.postbackEvents.length > 0 && (
                <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                  {JSON.stringify(evidence!.postbackEvents, null, 2)}
                </pre>
              )}
            </Card>
          )}

          <Card title="Did they open anything?" subtitle="Separates 'never started' from 'network never fired'.">
            <div className="space-y-1.5">
              {recentClicks.map((click, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span>{click.offerTitle ?? click.externalOfferId ?? 'unknown'}</span>
                  <span className="text-[var(--color-muted)]">{formatDateTime(click.createdAt)}</span>
                </div>
              ))}
              {recentClicks.length === 0 && (
                <p className="text-sm text-[var(--color-muted)]">
                  No recorded clicks. Either they never opened an offer, or they did so before click
                  tracking existed.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </AdminShell>
  )
}
