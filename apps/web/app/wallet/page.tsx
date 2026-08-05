'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, post } from '@/lib/api'
import { currentTheme, syncThemeAcrossTabs, type ThemeName } from '@/lib/theme'
import { monthlySummary, weekEarned, type Entry } from '@/lib/entries'
import { Shell, type Balance } from '@/components/shell'
import { Skeleton } from '@/components/ui'
import { TallyBalance } from '@/components/tally/balance'
import { TempoHome, type WeeklyState } from '@/components/tempo/home'

/**
 * The one screen where the two directions are genuinely different products
 * rather than the same product in two palettes.
 *
 * Tally answers "what do I have and what is it doing". Tempo answers "am I on
 * pace this week". Both read the same ledger; they disagree about which
 * question matters, which is the whole point of shipping both.
 */
export default function WalletPage() {
  const [theme, setTheme] = useState<ThemeName>('tally')
  const [balance, setBalance] = useState<Balance | null>(null)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [bonus, setBonus] = useState<{ claimedToday: boolean; currentStreak: number } | null>(null)
  const [claiming, setClaiming] = useState(false)

  const load = useCallback(() => {
    api<Balance>('/me/balance').then(setBalance).catch(() => {})
    api<{ entries: Entry[] }>('/me/history?limit=200')
      .then((r) => setEntries(r.entries))
      // An empty statement is a legitimate state for a new account, so a
      // failure here must not be indistinguishable from it.
      .catch(() => setEntries([]))
    api<{ claimedToday: boolean; currentStreak: number }>('/me/daily-bonus')
      .then(setBonus)
      .catch(() => {})
  }, [])

  useEffect(() => {
    setTheme(currentTheme())
    load()

    /**
     * The `data-theme` attribute is the single source of truth, watched rather
     * than re-read from storage.
     *
     * Reading storage directly here was the bug: another tab switching theme
     * fired a storage event, this component changed layout, and the attribute
     * driving every colour stayed put — Tempo's pace ring in Tally's amber.
     * Now storage only ever moves the attribute, and everything follows it.
     */
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const stopSync = syncThemeAcrossTabs()

    return () => {
      observer.disconnect()
      stopSync()
    }
  }, [load])

  const claim = async () => {
    setClaiming(true)
    try {
      await post('/me/daily-bonus')
      load()
    } finally {
      setClaiming(false)
    }
  }

  if (!balance || !entries) {
    return (
      <Shell>
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-48" />
        </div>
      </Shell>
    )
  }

  if (theme === 'tempo') {
    /**
     * The weekly target is derived, not configured: a shade above what this
     * user has actually been earning, floored at the cash-out minimum so the
     * target is always worth hitting. A target nobody can reach is worse than
     * no target, and one already met on Monday is not a target either.
     */
    const earned = weekEarned(entries)
    const recentPace = Math.round(monthlySummary(entries).total / 4) || 0
    const target = Math.max(balance.minRedemptionPoints, Math.round((recentPace * 1.15) / 100) * 100, 500)

    const weekly: WeeklyState = {
      earned,
      target,
      streak: bonus?.currentStreak ?? 0,
      claimedToday: bonus?.claimedToday ?? false,
    }

    return (
      <Shell>
        <TempoHome balance={balance} weekly={weekly} onClaim={claim} claiming={claiming} />
      </Shell>
    )
  }

  return (
    <Shell>
      <TallyBalance balance={balance} entries={entries} month={monthlySummary(entries)} />
    </Shell>
  )
}
