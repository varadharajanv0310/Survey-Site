'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { Card } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type Row = {
  networkId: string
  name: string
  key: string
  kind: string
  credits: number
  screenouts: number
  reversals: number
  grossUsdMicros: number
  reversedUsdMicros: number
  netRevenueUsdMicros: number
  paidToUsersUsdMicros: number
  marginUsdMicros: number
  reversalRateBps: number
}

const usd = (micros: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(micros / 1_000_000)

export default function ReportingPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [days, setDays] = useState(30)

  useEffect(() => {
    api<{ report: Row[] }>(`/admin/reporting/margin?days=${days}`)
      .then((r) => setRows(r.report))
      .catch(() => router.replace('/admin'))
  }, [days, router])

  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.grossUsdMicros,
      reversed: acc.reversed + r.reversedUsdMicros,
      paid: acc.paid + r.paidToUsersUsdMicros,
      margin: acc.margin + r.marginUsdMicros,
    }),
    { gross: 0, reversed: 0, paid: 0, margin: 0 },
  )

  return (
    <AdminShell>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Margin by network</h1>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                days === d ? 'bg-[var(--color-ink)] text-white' : 'text-[var(--color-muted)] hover:bg-slate-200'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-sm text-[var(--color-muted)]">
        The only question that matters about a supply partner: after reversals, is it making money?
        A network can be gross-revenue positive and still be a loss once clawbacks land.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Gross</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{usd(totals.gross)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Reversed</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--color-negative)]">
            −{usd(totals.reversed)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Paid to users
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{usd(totals.paid)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Margin</div>
          <div
            className={`mt-1 text-xl font-semibold tabular-nums ${
              totals.margin >= 0 ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]'
            }`}
          >
            {usd(totals.margin)}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-5 pb-2 font-medium">Network</th>
                <th className="px-5 pb-2 text-right font-medium">Credits</th>
                <th className="px-5 pb-2 text-right font-medium">Screenouts</th>
                <th className="px-5 pb-2 text-right font-medium">Reversals</th>
                <th className="px-5 pb-2 text-right font-medium">Gross</th>
                <th className="px-5 pb-2 text-right font-medium">Reversal rate</th>
                <th className="px-5 pb-2 text-right font-medium">Paid out</th>
                <th className="px-5 pb-2 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.networkId} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-[var(--color-muted)]">
                      {row.kind.replace('_', ' ')}
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{row.credits}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{row.screenouts}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{row.reversals}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{usd(row.grossUsdMicros)}</td>
                  <td
                    className={`px-5 py-2.5 text-right tabular-nums ${
                      row.reversalRateBps > 1500 ? 'font-semibold text-[var(--color-negative)]' : ''
                    }`}
                  >
                    {(row.reversalRateBps / 100).toFixed(1)}%
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {usd(row.paidToUsersUsdMicros)}
                  </td>
                  <td
                    className={`px-5 py-2.5 text-right font-semibold tabular-nums ${
                      row.marginUsdMicros >= 0
                        ? 'text-[var(--color-positive)]'
                        : 'text-[var(--color-negative)]'
                    }`}
                  >
                    {usd(row.marginUsdMicros)}
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
