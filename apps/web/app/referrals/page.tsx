'use client'

import { useEffect, useState } from 'react'
import { api, formatPoints } from '@/lib/api'
import { Shell } from '@/components/shell'
import { Button, Empty, PageHeader, Pill, Skeleton, Stat, Surface } from '@/components/ui'

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
  const [link, setLink] = useState('')

  useEffect(() => {
    api<ReferralData>('/me/referrals')
      .then((r) => {
        setData(r)
        setLink(`${window.location.origin}/signup?ref=${r.referralCode}`)
      })
      .catch(() => {})
  }, [])

  if (!data) {
    return (
      <Shell>
        <Skeleton className="mb-6 h-9 w-40" />
        <Skeleton className="h-64 w-full" />
      </Shell>
    )
  }

  const share = async () => {
    // Native share sheet where it exists — this audience shares to WhatsApp,
    // and a clipboard copy is a worse version of that on a phone.
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Earn with me', url: link })
        return
      } catch {
        /* dismissed; fall through to copy */
      }
    }
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const earning = data.referrals.filter((r) => r.qualifiedAt).length
  const commission = data.referrals.reduce((s, r) => s + r.lifetimeCommissionPoints, 0)

  return (
    <Shell>
      <PageHeader title="Refer a friend" />

      <div className="grid gap-3 sm:grid-cols-3">
        <Surface className="p-4">
          <Stat label="Joined" value={String(data.referrals.length)} />
        </Surface>
        <Surface className="p-4">
          <Stat label="Earning" value={String(earning)} hint="Bonus pays on their first earn" />
        </Surface>
        <Surface className="p-4">
          <Stat
            label="You've earned"
            value={formatPoints(commission)}
            tone={commission > 0 ? 'positive' : 'muted'}
          />
        </Surface>
      </div>

      <Surface className="mt-4 p-5">
        <h2 className="text-[15px] font-semibold">Your link</h2>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <code className="figure flex-1 overflow-x-auto rounded-[var(--radius-control)] border border-[var(--hairline)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] whitespace-nowrap">
            {link}
          </code>
          <Button onClick={share} className="shrink-0">
            {copied ? 'Copied' : 'Share'}
          </Button>
        </div>

        <p className="mt-4 text-[14px] leading-relaxed text-[var(--ink-2)]">
          You get{' '}
          <strong className="font-semibold text-[var(--ink)]">
            {formatPoints(data.bonusPoints)} points
          </strong>{' '}
          when a friend first earns something, then{' '}
          <strong className="font-semibold text-[var(--ink)]">{data.commissionBps / 100}%</strong>{' '}
          of everything they earn after that.
        </p>
        <p className="mt-2 text-[13px] text-[var(--ink-3)]">
          Their earnings are never reduced — your share comes out of ours. The bonus pays on their
          first completed offer rather than at signup, which is what keeps the programme worth
          running.
        </p>
      </Surface>

      <h2 className="mt-7 mb-3 text-[13px] tracking-[0.06em] text-[var(--ink-3)] uppercase">
        People you referred
      </h2>

      {data.referrals.length === 0 ? (
        <Surface>
          <Empty
            title="Nobody yet"
            body="Share your link above. You'll see them here as soon as they sign up, and you earn once they complete their first offer."
          />
        </Surface>
      ) : (
        <Surface className="divide-y divide-[var(--hairline)]">
          {data.referrals.map((referral) => (
            <div key={referral.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-[15px]">{referral.refereeEmail}</div>
                <div className="mt-0.5 text-[12px] text-[var(--ink-4)]">
                  Joined{' '}
                  {new Date(referral.attributedAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {referral.lifetimeCommissionPoints > 0 && (
                  <span className="figure text-[15px] font-semibold text-[var(--positive)]">
                    +{formatPoints(referral.lifetimeCommissionPoints)}
                  </span>
                )}
                <Pill tone={referral.qualifiedAt ? 'positive' : 'neutral'}>
                  {referral.qualifiedAt ? 'Earning' : 'Not yet'}
                </Pill>
              </div>
            </div>
          ))}
        </Surface>
      )}
    </Shell>
  )
}
