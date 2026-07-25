'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, formatDateTime } from '@/lib/api'
import { Badge, Card } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type Ticket = {
  id: string
  userId: string
  userEmail: string
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
  other: 'Other',
}

const STATUS_TONE: Record<string, string> = {
  open: 'info',
  awaiting_user: 'warn',
  resolved: 'positive',
  closed: 'default',
}

const FILTERS = ['open', 'awaiting_user', 'resolved', 'closed', '']

export default function AdminTicketsPage() {
  const router = useRouter()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [status, setStatus] = useState('open')

  useEffect(() => {
    api<{ tickets: Ticket[] }>(`/admin/tickets${status ? `?status=${status}` : ''}`)
      .then((r) => setTickets(r.tickets))
      .catch(() => router.replace('/admin'))
  }, [status, router])

  return (
    <AdminShell>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Support</h1>
        <div className="flex gap-1">
          {FILTERS.map((value) => (
            <button
              key={value || 'all'}
              onClick={() => setStatus(value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                status === value
                  ? 'bg-[var(--color-ink)] text-white'
                  : 'text-[var(--color-muted)] hover:bg-slate-200'
              }`}
            >
              {value ? value.replace('_', ' ') : 'all'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {tickets.map((ticket) => (
          <Card
            key={ticket.id}
            className="cursor-pointer transition hover:border-[var(--color-brand)]"
          >
            <div
              onClick={() => router.push(`/admin/tickets/${ticket.id}`)}
              className="flex items-center justify-between gap-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{ticket.subject}</span>
                  <Badge>{KIND_LABELS[ticket.kind] ?? ticket.kind}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                  {ticket.userEmail} · {formatDateTime(ticket.createdAt)}
                  {ticket.externalTransactionId && (
                    <> · <code className="font-mono">{ticket.externalTransactionId}</code></>
                  )}
                </div>
              </div>
              <Badge tone={STATUS_TONE[ticket.status]}>{ticket.status.replace('_', ' ')}</Badge>
            </div>
          </Card>
        ))}

        {tickets.length === 0 && (
          <Card>
            <p className="py-6 text-center text-sm text-[var(--color-muted)]">
              Nothing in this queue.
            </p>
          </Card>
        )}
      </div>
    </AdminShell>
  )
}
