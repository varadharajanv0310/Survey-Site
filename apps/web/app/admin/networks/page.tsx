'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, formatDateTime, post } from '@/lib/api'
import { Badge, Button, Card } from '@/components/shell'
import { AdminShell } from '@/components/admin-shell'

type Network = {
  id: string
  key: string
  name: string
  kind: string
  enabled: boolean
  revenueShareBps: number
  secretRef: string | null
  lastSyncedAt: string | null
  lastPostbackAt: string | null
}

export default function NetworksPage() {
  const router = useRouter()
  const [networks, setNetworks] = useState<Network[]>([])
  const [registered, setRegistered] = useState<string[]>([])

  const load = () => {
    api<{ networks: Network[]; registeredAdapters: string[] }>('/admin/networks')
      .then((r) => {
        setNetworks(r.networks)
        setRegistered(r.registeredAdapters)
      })
      .catch(() => router.replace('/admin'))
  }

  useEffect(load, [router])

  const update = async (id: string, patch: Partial<Network>) => {
    await post(`/admin/networks/${id}`, patch)
    load()
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold tracking-tight">Networks</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Secrets live in environment variables; the database stores only the variable name, so
        credentials never appear here or in a backup.
      </p>

      <div className="mt-5 space-y-3">
        {networks.map((network) => {
          const hasAdapter = registered.includes(network.key)
          return (
            <Card key={network.id}>
              <div className="flex items-start gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{network.name}</h2>
                    <Badge tone={network.kind === 'survey_wall' ? 'info' : 'default'}>
                      {network.kind.replace('_', ' ')}
                    </Badge>
                    <Badge tone={network.enabled ? 'positive' : 'default'}>
                      {network.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                    {!hasAdapter && <Badge tone="negative">no adapter</Badge>}
                  </div>

                  <div className="mt-2 grid gap-x-8 gap-y-1 text-xs text-[var(--color-muted)] sm:grid-cols-2">
                    <span>key: <code className="font-mono">{network.key}</code></span>
                    <span>
                      secret: <code className="font-mono">{network.secretRef ?? 'not configured'}</code>
                    </span>
                    <span>
                      last catalog sync:{' '}
                      {network.lastSyncedAt ? formatDateTime(network.lastSyncedAt) : 'never'}
                    </span>
                    <span>
                      last postback:{' '}
                      {network.lastPostbackAt ? formatDateTime(network.lastPostbackAt) : 'never'}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs text-[var(--color-muted)]">
                      Our share
                      <input
                        type="number"
                        defaultValue={network.revenueShareBps / 100}
                        min={0}
                        max={100}
                        step={0.5}
                        onBlur={(e) =>
                          update(network.id, {
                            revenueShareBps: Math.round(Number(e.target.value) * 100),
                          })
                        }
                        className="ml-2 w-20 rounded-md border border-[var(--color-line)] px-2 py-1 text-sm tabular-nums"
                      />
                      <span className="ml-1">%</span>
                    </label>
                    <span className="text-xs text-[var(--color-muted)]">
                      user receives {(100 - network.revenueShareBps / 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <Button
                  variant={network.enabled ? 'ghost' : 'primary'}
                  onClick={() => update(network.id, { enabled: !network.enabled })}
                  disabled={!hasAdapter && !network.enabled}
                  title={!hasAdapter ? 'No adapter is registered for this network key' : undefined}
                >
                  {network.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
    </AdminShell>
  )
}
