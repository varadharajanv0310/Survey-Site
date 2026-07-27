'use client'

import { useCallback, useEffect, useState } from 'react'
import { API_URL, api, formatPoints, post } from '@/lib/api'
import { getFingerprint } from '@/lib/fingerprint'
import { Shell } from '@/components/shell'
import { Button, Empty, PageHeader, Pill, Skeleton, Surface } from '@/components/ui'

type Offer = {
  id: string
  title: string
  description: string | null
  requirements: string | null
  category: string
  points: number
  estimatedMinutes: number | null
  networkName: string
  url: string
}

type Wall = { id: string; name: string; networkName: string; url: string }
type Feed = { offers: Offer[]; walls: Wall[]; country: string }
type DailyBonus = { claimedToday: boolean; currentStreak: number }

const CATEGORY_LABELS: Record<string, string> = {
  survey: 'Survey',
  app_install: 'App',
  signup: 'Sign up',
  purchase: 'Purchase',
  game: 'Game',
  video: 'Video',
  other: 'Offer',
}

export default function EarnPage() {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [bonus, setBonus] = useState<DailyBonus | null>(null)
  const [filter, setFilter] = useState('all')
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState('')

  const load = useCallback(() => {
    api<Feed>('/offers').then(setFeed).catch(() => setFeed({ offers: [], walls: [], country: 'IN' }))
    api<DailyBonus>('/me/daily-bonus').then(setBonus).catch(() => {})
  }, [])

  useEffect(load, [load])

  const claim = async () => {
    setClaiming(true)
    try {
      const r = await post<{ points: number; streakDay: number }>('/me/daily-bonus')
      setClaimed(`+${formatPoints(r.points)} points · day ${r.streakDay}`)
      load()
    } catch (err) {
      setClaimed(err instanceof Error ? err.message : 'Could not claim')
    } finally {
      setClaiming(false)
    }
  }

  /**
   * Record the click, then open. Never awaited before navigation — a user who
   * taps and waits taps again. `sendBeacon` covers the case where the page is
   * backgrounded the instant the offer opens and a normal fetch is cancelled.
   */
  const trackClick = (payload: { offerId?: string; placementId?: string }) => {
    getFingerprint().then((deviceFingerprint) => {
      const body = JSON.stringify({ ...payload, deviceFingerprint })
      post('/offers/click', { ...payload, deviceFingerprint }).catch(() => {
        navigator.sendBeacon?.(
          `${API_URL}/offers/click`,
          new Blob([body], { type: 'application/json' }),
        )
      })
    })
  }

  if (!feed) {
    return (
      <Shell>
        <Skeleton className="mb-6 h-9 w-32" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </Shell>
    )
  }

  const categories = ['all', ...new Set(feed.offers.map((o) => o.category))]
  const visible = feed.offers.filter((o) => filter === 'all' || o.category === filter)

  return (
    <Shell>
      <PageHeader title="Earn" meta={`Available where you are · ${feed.country}`} />

      {/* Daily bonus. Small, cheap, and most of why someone opens the app on
          day 30 rather than day 1. */}
      <Surface className="mb-5 flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold">Daily bonus</h2>
            {bonus && bonus.currentStreak > 0 && (
              <Pill tone="accent">{bonus.currentStreak} day streak</Pill>
            )}
          </div>
          <p className="mt-1 text-[13px] text-[var(--ink-3)]">
            {claimed ||
              (bonus?.claimedToday
                ? 'Claimed. Come back tomorrow to keep the streak.'
                : 'Claim once a day. The longer the streak, the larger it gets.')}
          </p>
        </div>
        <Button
          onClick={claim}
          loading={claiming}
          disabled={bonus?.claimedToday}
          variant={bonus?.claimedToday ? 'quiet' : 'primary'}
          size="sm"
        >
          {bonus?.claimedToday ? 'Claimed' : 'Claim'}
        </Button>
      </Surface>

      {/* Survey walls. Not offers — a doorway with no fixed reward, and saying
          so up front prevents the "I did a survey and got 1 point" ticket. */}
      {feed.walls.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-3 text-[13px] tracking-[0.06em] text-[var(--ink-3)] uppercase">
            Surveys
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {feed.walls.map((wall) => (
              <a
                key={wall.id}
                href={wall.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackClick({ placementId: wall.id })}
                className="group rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--accent-wash)] p-5 transition-colors [backdrop-filter:var(--frost)] hover:border-[var(--accent)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[16px] font-semibold">{wall.name}</h3>
                  <span className="text-[12px] text-[var(--ink-3)]">{wall.networkName}</span>
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
                  Answer a few questions to see which surveys you qualify for. If you don&apos;t
                  qualify you still get a small amount for trying.
                </p>
                <span className="mt-3 inline-block text-[14px] font-semibold text-[var(--accent)]">
                  Open surveys →
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] tracking-[0.06em] text-[var(--ink-3)] uppercase">Offers</h2>
        <div className="-mr-5 flex gap-1.5 overflow-x-auto pr-5 lg:mr-0 lg:pr-0">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`shrink-0 rounded-[var(--radius-pill)] px-2.5 py-1 text-[12.5px] transition-colors ${
                filter === c
                  ? 'bg-[var(--accent)] font-semibold text-[var(--accent-ink)]'
                  : 'text-[var(--ink-3)] hover:text-[var(--ink)]'
              }`}
            >
              {c === 'all' ? 'All' : (CATEGORY_LABELS[c] ?? c)}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Surface>
          <Empty
            title="No offers right now"
            body={`Nothing matches this filter for ${feed.country}. Inventory rotates as networks update what they have, so it is worth checking back.`}
            action={
              filter !== 'all' ? (
                <Button variant="quiet" size="sm" onClick={() => setFilter('all')}>
                  Show all
                </Button>
              ) : undefined
            }
          />
        </Surface>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((offer) => (
            <a
              key={offer.id}
              href={offer.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackClick({ offerId: offer.id })}
              className="flex flex-col rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4 transition-colors [backdrop-filter:var(--frost)] [box-shadow:var(--elevation)] hover:border-[var(--accent)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[15px] leading-snug font-semibold">{offer.title}</h3>
                <span className="figure shrink-0 text-[17px] font-semibold text-[var(--positive)]">
                  {formatPoints(offer.points)}
                </span>
              </div>

              {offer.description && (
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-3)]">
                  {offer.description}
                </p>
              )}

              {offer.requirements && (
                <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--warning)]">
                  {offer.requirements}
                </p>
              )}

              <div className="mt-auto flex items-center gap-2 pt-3.5 text-[12px] text-[var(--ink-4)]">
                <Pill>{CATEGORY_LABELS[offer.category] ?? offer.category}</Pill>
                {offer.estimatedMinutes && <span>~{offer.estimatedMinutes} min</span>}
                <span className="ml-auto truncate">{offer.networkName}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </Shell>
  )
}
