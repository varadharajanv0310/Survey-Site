'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, formatDate, formatPoints } from '@/lib/api'
import { Badge, Card, Input } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type Row = {
  id: string
  email: string
  status: string
  country: string | null
  created_at: string
  email_verified_at: string | null
  posted: string
  withdrawable: string
  pending: string
  lifetime_earned: string
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      api<{ users: Row[] }>(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`)
        .then((r) => setRows(r.users))
        .catch(() => router.replace('/admin'))
    }, 200)
    return () => clearTimeout(timer)
  }, [search, router])

  return (
    <AdminShell>
      <div className="flex items-baseline justify-between gap-6">
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <div className="w-72">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email"
          />
        </div>
      </div>

      <Card className="mt-5">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-5 pb-2 font-medium">Email</th>
                <th className="px-5 pb-2 font-medium">Status</th>
                <th className="px-5 pb-2 font-medium">Country</th>
                <th className="px-5 pb-2 text-right font-medium">Balance</th>
                <th className="px-5 pb-2 text-right font-medium">Available</th>
                <th className="px-5 pb-2 text-right font-medium">Under review</th>
                <th className="px-5 pb-2 text-right font-medium">Lifetime</th>
                <th className="px-5 pb-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/admin/users/${row.id}`)}
                  className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-5 py-2.5">
                    {row.email}
                    {!row.email_verified_at && (
                      <span className="ml-2 text-xs text-[var(--color-warn)]">unverified</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <Badge
                      tone={
                        row.status === 'active'
                          ? 'positive'
                          : row.status === 'banned'
                            ? 'negative'
                            : 'warn'
                      }
                    >
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-2.5 text-[var(--color-muted)]">{row.country ?? '—'}</td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums">
                    {formatPoints(Number(row.posted))}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {formatPoints(Number(row.withdrawable))}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {Number(row.pending) > 0 ? (
                      <span className="text-[var(--color-warn)]">
                        {formatPoints(Number(row.pending))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-[var(--color-muted)]">
                    {formatPoints(Number(row.lifetime_earned))}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--color-muted)]">
                    {formatDate(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminShell>
  )
}
