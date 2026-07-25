'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, formatDateTime } from '@/lib/api'
import { Button, Card } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type Setting = {
  key: string
  value: unknown
  valueType: string
  description: string | null
  updatedAt: string
}

const GROUPS: { title: string; note: string; match: (key: string) => boolean }[] = [
  {
    title: 'Points economy',
    note: 'Changing the rate does not re-price history — every ledger entry stores the config version it was written under.',
    match: (k) => k.startsWith('points_') || k.includes('revenue_share') || k === 'min_award_points',
  },
  {
    title: 'Holds and redemption',
    note: 'Longer holds mean fewer losses to late clawbacks and slower payouts for users.',
    match: (k) => k.startsWith('hold_') || k.includes('redemption') || k.startsWith('review_'),
  },
  {
    title: 'Growth',
    note: 'The referral bonus pays on the referee’s first earning, not at signup.',
    match: (k) => k.startsWith('referral_') || k.startsWith('daily_bonus_'),
  },
  {
    title: 'Fraud',
    note: 'fraud_fail_mode is a risk decision: “closed” blocks credits when a check errors, “open” lets them through.',
    match: (k) => k.startsWith('fraud_') || k.startsWith('max_') || k.includes('negative_balance'),
  },
]

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<Setting[]>([])
  const [version, setVersion] = useState(0)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  const load = () => {
    api<{ settings: Setting[]; configVersion: number }>('/admin/settings')
      .then((r) => {
        setSettings(r.settings)
        setVersion(r.configVersion)
      })
      .catch(() => router.replace('/admin'))
  }

  useEffect(load, [router])

  const save = async (setting: Setting) => {
    const raw = edits[setting.key]
    if (raw === undefined) return

    let parsed: unknown = raw
    if (setting.valueType === 'number') parsed = Number(raw)
    else if (setting.valueType === 'boolean') parsed = raw === 'true'

    const reason = window.prompt(`Reason for changing ${setting.key}:`)
    if (!reason) return

    await api(`/admin/settings/${setting.key}`, {
      method: 'PUT',
      body: JSON.stringify({ value: parsed, reason }),
    })
    setMessage(`${setting.key} updated`)
    setEdits((e) => {
      const next = { ...e }
      delete next[setting.key]
      return next
    })
    load()
  }

  const ungrouped = settings.filter((s) => !GROUPS.some((g) => g.match(s.key)))

  return (
    <AdminShell>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <span className="text-xs text-[var(--color-muted)]">config version {version}</span>
      </div>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Every business number lives here rather than as a literal in code. Changes are versioned and
        each requires a reason.
      </p>
      {message && <p className="mt-2 text-sm text-[var(--color-positive)]">{message}</p>}

      <div className="mt-5 space-y-5">
        {[...GROUPS.map((g) => ({ ...g, rows: settings.filter((s) => g.match(s.key)) })),
          { title: 'Other', note: '', rows: ungrouped, match: () => false },
        ]
          .filter((g) => g.rows.length > 0)
          .map((group) => (
            <Card key={group.title} title={group.title} subtitle={group.note}>
              <div className="space-y-2">
                {group.rows.map((setting) => (
                  <div
                    key={setting.key}
                    className="flex items-center gap-4 rounded-lg border border-[var(--color-line)] px-4 py-2.5"
                  >
                    <div className="flex-1">
                      <code className="font-mono text-sm font-medium">{setting.key}</code>
                      {setting.description && (
                        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                          {setting.description}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-slate-400">
                        updated {formatDateTime(setting.updatedAt)}
                      </p>
                    </div>

                    {setting.valueType === 'boolean' ? (
                      <select
                        value={edits[setting.key] ?? String(setting.value)}
                        onChange={(e) => setEdits({ ...edits, [setting.key]: e.target.value })}
                        className="w-40 rounded-md border border-[var(--color-line)] px-2 py-1.5 text-sm"
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        value={edits[setting.key] ?? String(setting.value)}
                        onChange={(e) => setEdits({ ...edits, [setting.key]: e.target.value })}
                        className="w-40 rounded-md border border-[var(--color-line)] px-2 py-1.5 text-sm tabular-nums"
                      />
                    )}

                    <Button
                      variant="ghost"
                      onClick={() => save(setting)}
                      disabled={edits[setting.key] === undefined}
                    >
                      Save
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
      </div>
    </AdminShell>
  )
}
