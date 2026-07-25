'use client'

import { useEffect, useState } from 'react'
import { API_URL, api, formatPoints, post } from '@/lib/api'
import { getFingerprint } from '@/lib/fingerprint'
import { Badge, Button, Card, Shell } from '@/components/shell'

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
  const [filter, setFilter] = useState<string>('all')
  const [claiming, setClaiming] = useState(false)
  const [message, setMessage] = useState('')

  const load = () => {
    api<Feed>('/offers').then(setFeed).catch(() => {})
    api<DailyBonus>('/me/daily-bonus').then(setBonus).catch(() => {})
  }

  useEffect(load, [])

  const claim = async () => {
    setClaiming(true)
    try {
      const result = await post<{ points: number; streakDay: number }>('/me/daily-bonus')
      setMessage(`+${result.points} points — day ${result.streakDay} of your streak`)
      load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'could not claim')
    } finally {
      setClaiming(false)
    }
  }

  /**
   * Record the click, then open. Deliberately does not await the record before
   * opening: a user who taps and waits taps again, and a lost click is a worse
   * support answer rather than a broken flow.
   *
   * `sendBeacon` where available, because the page may be backgrounded the
   * instant the offer opens and a normal fetch would be cancelled.
   */
  const trackClick = (payload: { offerId?: string; placementId?: string }) => {
    getFingerprint().then((deviceFingerprint) => {
      const body = JSON.stringify({ ...payload, deviceFingerprint })
      post('/offers/click', { ...payload, deviceFingerprint }).catch(() => {
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(`${API_URL}/offers/click`, new Blob([body], { type: 'application/json' }))
        }
      })
    })
  }

  const categories = ['all', ...new Set(feed?.offers.map((o) => o.category) ?? [])]
  const visible = feed?.offers.filter((o) => filter === 'all' || o.category === filter) ?? []

  return (
    <Shell>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Earn</h1>
        <span className="text-xs text-[var(--color-muted)]">
          Showing offers available in {feed?.country ?? '…'}
        </span>
      </div>

      {/* Daily bonus. Cheap to build, and most of why someone opens the site
          on day 30 rather than day 1. */}
      <Card className="mt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Daily bonus</h2>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              {bonus?.claimedToday
                ? `Claimed today. Current streak: ${bonus.currentStreak} day${bonus.currentStreak === 1 ? '' : 's'}.`
                : 'Claim once a day. The longer the streak, the bigger the bonus.'}
            </p>
            {message && <p className="mt-1 text-xs text-[var(--color-positive)]">{message}</p>}
          </div>
          <Button onClick={claim} disabled={claiming || bonus?.claimedToday}>
            {bonus?.claimedToday ? 'Claimed' : claiming ? 'Claiming…' : 'Claim'}
          </Button>
        </div>
      </Card>

      {/* Survey walls are iframes, not a list of offers — their own JS decides
          what to show in real time. Rendered as entry points, not as rows. */}
      {feed && feed.walls.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold">Surveys</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {feed.walls.map((wall) => (
              <a
                key={wall.id}
                href={wall.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackClick({ placementId: wall.id })}
                className="group rounded-xl border border-[var(--color-line)] bg-gradient-to-br from-indigo-50 to-white p-5 transition hover:border-[var(--color-brand)]"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{wall.name}</h3>
                  <Badge tone="info">{wall.networkName}</Badge>
                </div>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  Answer a few questions to see which surveys you qualify for. Partial credit is
                  paid if you are screened out.
                </p>
                <span className="mt-3 inline-block text-sm font-medium text-[var(--color-brand)]">
                  Open surveys →
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Offers</h2>
        <div className="flex gap-1">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setFilter(category)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                filter === category
                  ? 'bg-[var(--color-ink)] text-white'
                  : 'text-[var(--color-muted)] hover:bg-slate-100'
              }`}
            >
              {category === 'all' ? 'All' : (CATEGORY_LABELS[category] ?? category)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((offer) => (
          <a
            key={offer.id}
            href={offer.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackClick({ offerId: offer.id })}
            className="flex flex-col rounded-xl border border-[var(--color-line)] bg-white p-4 transition hover:border-[var(--color-brand)] hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold leading-snug">{offer.title}</h3>
              <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-sm font-semibold tabular-nums text-[var(--color-positive)]">
                {formatPoints(offer.points)}
              </span>
            </div>

            {offer.description && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
                {offer.description}
              </p>
            )}

            {offer.requirements && (
              <p className="mt-2 border-l-2 border-amber-200 pl-2 text-xs text-[var(--color-warn)]">
                {offer.requirements}
              </p>
            )}

            <div className="mt-auto flex items-center gap-2 pt-3 text-xs text-[var(--color-muted)]">
              <Badge>{CATEGORY_LABELS[offer.category] ?? offer.category}</Badge>
              {offer.estimatedMinutes && <span>~{offer.estimatedMinutes} min</span>}
              <span className="ml-auto">{offer.networkName}</span>
            </div>
          </a>
        ))}
      </div>

      {feed && visible.length === 0 && (
        <Card className="mt-3">
          <p className="text-sm text-[var(--color-muted)]">
            No offers match this filter for {feed.country} right now. Offers rotate as networks
            update their inventory.
          </p>
        </Card>
      )}
    </Shell>
  )
}
