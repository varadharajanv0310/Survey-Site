'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, formatDateTime, post } from '@/lib/api'
import { Badge, Button, Card } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type ReviewItem = {
  id: string
  subjectType: string
  subjectId: string
  userId: string | null
  userEmail: string | null
  reason: string
  priority: number
  createdAt: string
}

export default function ReviewQueuePage() {
  const router = useRouter()
  const [items, setItems] = useState<ReviewItem[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    api<{ items: ReviewItem[] }>('/admin/review?state=open')
      .then((r) => setItems(r.items))
      .catch(() => router.replace('/admin'))
  }

  useEffect(load, [router])

  const resolve = async (id: string, resolution: 'allow' | 'deny') => {
    setBusy(id)
    try {
      await post(`/admin/review/${id}/resolve`, { resolution, notes: notes[id] })
      load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminShell>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Review queue</h1>
        <span className="text-sm text-[var(--color-muted)]">{items.length} open</span>
      </div>

      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Flagged credits are held rather than rejected — most flagged users are real people on a
        shared address. Payout reviews sort first, because that is where money actually leaves.
      </p>

      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <Card key={item.id}>
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Badge tone={item.subjectType === 'payout' ? 'negative' : 'warn'}>
                    {item.subjectType}
                  </Badge>
                  <span className="text-sm font-medium">{item.userEmail ?? 'unknown user'}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    score {item.priority} · {formatDateTime(item.createdAt)}
                  </span>
                </div>

                <p className="mt-2 font-mono text-xs text-[var(--color-muted)]">{item.reason}</p>

                <input
                  value={notes[item.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
                  placeholder="Note (optional, recorded in the audit log)"
                  className="mt-3 w-full rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
                />
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <Button onClick={() => resolve(item.id, 'allow')} disabled={busy === item.id}>
                  Allow
                </Button>
                <Button
                  variant="danger"
                  onClick={() => resolve(item.id, 'deny')}
                  disabled={busy === item.id}
                >
                  Deny
                </Button>
              </div>
            </div>
          </Card>
        ))}

        {items.length === 0 && (
          <Card>
            <p className="py-6 text-center text-sm text-[var(--color-muted)]">
              Nothing waiting for review.
            </p>
          </Card>
        )}
      </div>
    </AdminShell>
  )
}
