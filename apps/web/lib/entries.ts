import type { StatusTone } from '@/components/ui'

export type Entry = {
  id: string
  amountPoints: number
  type: string
  status: string
  availableAt: string
  note: string | null
  createdAt: string
  networkName: string | null
}

const TYPE_TITLES: Record<string, string> = {
  earn: 'Offer completed',
  screenout: 'Survey screenout',
  reversal: 'Taken back by network',
  redeem: 'Cash out',
  redeem_refund: 'Cash out returned',
  manual_adjustment: 'Adjustment',
  bonus: 'Daily bonus',
  referral_bonus: 'Referral bonus',
  referral_commission: 'Referral share',
}

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase()

/**
 * Every row gets a reason, in words, with a date.
 *
 * This is the whole trust argument of the Tally direction and it is why this
 * lives in one function: a status rendered anywhere without its explanation
 * would quietly undo the thing the design is for. "CLEARING" alone tells a
 * user nothing; "CLEARS 30 JUL" tells them when to stop worrying.
 */
export function describeEntry(entry: Entry): {
  title: string
  status: string
  tone: StatusTone
  detail: string | null
} {
  const title = TYPE_TITLES[entry.type] ?? entry.type.replace(/_/g, ' ')
  const clearing = new Date(entry.availableAt) > new Date()

  if (entry.status === 'pending') {
    return {
      title,
      status: 'IN REVIEW',
      tone: 'pending',
      detail: 'Being checked before it credits. Most clear within a day.',
    }
  }

  if (entry.status === 'rejected') {
    return {
      title,
      status: 'NOT CREDITED',
      tone: 'negative',
      detail: entry.note ?? 'This did not pass our checks.',
    }
  }

  if (entry.type === 'reversal') {
    return {
      title,
      status: `TAKEN BACK ${shortDate(entry.createdAt)}`,
      tone: 'negative',
      detail: entry.note ?? 'The network cancelled this completion after crediting it.',
    }
  }

  if (entry.type === 'screenout') {
    return {
      title,
      status: `PAID ${shortDate(entry.createdAt)}`,
      tone: 'neutral',
      detail: 'You did not qualify for this survey. Partial credit is still paid.',
    }
  }

  if (entry.type === 'redeem') {
    return {
      title,
      status: `SENT ${shortDate(entry.createdAt)}`,
      tone: 'neutral',
      detail: 'Deducted when you requested the payout.',
    }
  }

  if (clearing) {
    return {
      title,
      status: `CLEARS ${shortDate(entry.availableAt)}`,
      tone: 'pending',
      detail: 'Withdrawable once the network can no longer take it back.',
    }
  }

  return {
    title,
    status: `CREDITED ${shortDate(entry.createdAt)}`,
    tone: 'positive',
    detail: null,
  }
}

/** Bucket a month of entries into per-day totals for the balance chart. */
export function monthlySummary(entries: Entry[]) {
  const now = new Date()
  const year = now.getFullYear()
  const monthIndex = now.getMonth()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

  const days = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, points: 0 }))
  let total = 0

  for (const entry of entries) {
    if (entry.amountPoints <= 0 || entry.status !== 'posted') continue
    const at = new Date(entry.createdAt)
    if (at.getFullYear() !== year || at.getMonth() !== monthIndex) continue
    days[at.getDate() - 1]!.points += entry.amountPoints
    total += entry.amountPoints
  }

  const best = days.reduce<{ day: number; points: number } | null>(
    (acc, d) => (!acc || d.points > acc.points ? d : acc),
    null,
  )

  return { total, days, best }
}

/** Points earned in the trailing seven days. Feeds Tempo's pace ring. */
export function weekEarned(entries: Entry[]): number {
  const cutoff = Date.now() - 7 * 86_400_000
  return entries
    .filter((e) => e.amountPoints > 0 && e.status === 'posted')
    .filter((e) => new Date(e.createdAt).getTime() >= cutoff)
    .reduce((sum, e) => sum + e.amountPoints, 0)
}
