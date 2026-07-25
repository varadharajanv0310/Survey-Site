'use client'

import { useEffect, useState } from 'react'
import { api, formatDate, formatPoints } from '@/lib/api'
import { Badge, Button, Card, Shell, Stat } from '@/components/shell'

type ReferralData = {
  referralCode: string
  bonusPoints: number
  commissionBps: number
  referrals: {
    id: string
    refereeEmail: string
    attributedAt: string
    qualifiedAt: string | null
    lifetimeCommissionPoints: number
  }[]
}

export default function ReferralsPage() {
  const [data, setData] = useState<ReferralData | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api<ReferralData>('/me/referrals').then(setData).catch(() => {})
  }, [])

  if (!data) return <Shell><p className="text-sm text-[var(--color-muted)]">Loading…</p></Shell>

  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/signup?ref=${data.referralCode}`
      : ''

  const totalCommission = data.referrals.reduce((s, r) => s + r.lifetimeCommissionPoints, 0)
  const qualified = data.referrals.filter((r) => r.qualifiedAt).length

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight">Refer a friend</h1>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat label="Friends joined" value={String(data.referrals.length)} />
        </Card>
        <Card>
          <Stat
            label="Earning"
            value={String(qualified)}
            hint="Bonus pays once they first earn"
          />
        </Card>
        <Card>
          <Stat label="Commission earned" value={`${formatPoints(totalCommission)} pts`} />
        </Card>
      </div>

      <Card title="Your link" className="mt-6">
        <div className="flex gap-2">
          <code className="flex-1 overflow-x-auto rounded-md border border-[var(--color-line)] bg-slate-50 px-3 py-2 font-mono text-sm">
            {link}
          </code>
          <Button
            onClick={() => {
              navigator.clipboard.writeText(link)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <p className="mt-3 text-sm text-[var(--color-muted)]">
          You get <strong className="text-[var(--color-ink)]">{formatPoints(data.bonusPoints)} points</strong>{' '}
          when a friend first earns something, then{' '}
          <strong className="text-[var(--color-ink)]">{data.commissionBps / 100}%</strong> of
          everything they earn after that — taken from our side, never theirs.
        </p>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          The bonus pays on their first completed offer rather than at signup, which is what keeps
          the programme worth running.
        </p>
      </Card>

      <Card title="Your referrals" className="mt-6">
        <div className="space-y-2">
          {data.referrals.map((referral) => (
            <div
              key={referral.id}
              className="flex items-center justify-between rounded-lg border border-[var(--color-line)] px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">{referral.refereeEmail}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  Joined {formatDate(referral.attributedAt)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {referral.lifetimeCommissionPoints > 0 && (
                  <span className="text-sm font-semibold tabular-nums text-[var(--color-positive)]">
                    +{formatPoints(referral.lifetimeCommissionPoints)}
                  </span>
                )}
                <Badge tone={referral.qualifiedAt ? 'positive' : 'default'}>
                  {referral.qualifiedAt ? 'Earning' : 'Not yet earning'}
                </Badge>
              </div>
            </div>
          ))}

          {data.referrals.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--color-muted)]">
              No referrals yet. Share your link above.
            </p>
          )}
        </div>
      </Card>
    </Shell>
  )
}
