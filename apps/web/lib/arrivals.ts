import type { Entry } from './entries'

/**
 * Groups the ledger by WHEN, not by what.
 *
 * Tally and Tempo both sort by recency, which answers "what happened". The
 * question users actually ask support is "when do I get my money", and that
 * needs the opposite axis: what has landed, what is scheduled and for when,
 * what is still with the network, what a human is looking at.
 *
 * Ordering is deliberate — arriving things first, settled things last. A user
 * opening the app wants the future, not the archive.
 */

export type ArrivalGroup = {
  key: string
  label: string
  /** Set when every row in the group shares a landing date. */
  when: string | null
  tone: 'scheduled' | 'landed' | 'review' | 'gone'
  note: string
  entries: Entry[]
  total: number
}

const DAY = 86_400_000

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

const relativeDay = (target: Date, now: Date): string => {
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((a.getTime() - b.getTime()) / DAY)

  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days > 1 && days < 7) {
    return target.toLocaleDateString('en-IN', { weekday: 'long' })
  }
  return target.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/**
 * The left column of the board, scaled to how far away the moment is.
 *
 * A clock time is only meaningful for today. `00:34` against something that
 * landed five days ago is noise, and a column of identical times stops being
 * a board at all — which is exactly what the first build looked like.
 */
export function boardTime(value: string, now = new Date()): string {
  const at = new Date(value)
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()

  if (sameDay) {
    return at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) /
      DAY,
  )

  // Inside the last week a weekday is easier to place than a date.
  if (days > 0 && days < 7) return at.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()
  if (days < 0 && days > -7) return at.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()

  return at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase()
}

export function buildBoard(entries: Entry[], now = new Date()): ArrivalGroup[] {
  const groups: ArrivalGroup[] = []
  const push = (g: Omit<ArrivalGroup, 'total'>) => {
    if (g.entries.length === 0) return
    groups.push({ ...g, total: g.entries.reduce((s, e) => s + e.amountPoints, 0) })
  }

  const isFuture = (e: Entry) => new Date(e.availableAt).getTime() > now.getTime()

  // Under review first: it is the only state a user can do nothing about and
  // the one most likely to worry them, so it should not be buried.
  push({
    key: 'review',
    label: 'Being checked',
    when: null,
    tone: 'review',
    note: 'A person is looking at these. Most clear within a day.',
    entries: entries.filter((e) => e.status === 'pending'),
  })

  // Scheduled credits, bucketed by the day they become withdrawable.
  const scheduled = entries.filter(
    (e) => e.status === 'posted' && e.amountPoints > 0 && isFuture(e),
  )
  const byDay = new Map<string, Entry[]>()
  for (const entry of scheduled) {
    const key = dayKey(new Date(entry.availableAt))
    byDay.set(key, [...(byDay.get(key) ?? []), entry])
  }

  const days = [...byDay.entries()].sort(
    (a, b) =>
      new Date(a[1][0]!.availableAt).getTime() - new Date(b[1][0]!.availableAt).getTime(),
  )

  for (const [key, dayEntries] of days) {
    const when = new Date(dayEntries[0]!.availableAt)
    push({
      key: `scheduled-${key}`,
      label: relativeDay(when, now),
      when: when.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).toUpperCase(),
      tone: 'scheduled',
      note: 'Clears once the network can no longer take it back.',
      entries: dayEntries,
    })
  }

  // Everything already withdrawable, newest first.
  push({
    key: 'landed',
    label: 'Landed',
    when: null,
    tone: 'landed',
    note: 'Yours. Available to cash out now.',
    entries: entries
      .filter((e) => e.status === 'posted' && e.amountPoints > 0 && !isFuture(e))
      .slice(0, 25),
  })

  // Reversals and rejections. Kept visible rather than netted off silently —
  // a user who cannot see the clawback assumes the site took the money.
  push({
    key: 'gone',
    label: 'Taken back',
    when: null,
    tone: 'gone',
    note: 'The network cancelled these after crediting them.',
    entries: entries.filter((e) => e.type === 'reversal' || e.status === 'rejected').slice(0, 15),
  })

  return groups
}

/** Points landing between now and the end of tomorrow. Drives the header. */
export function landingSoon(entries: Entry[], now = new Date()): { points: number; count: number } {
  const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime()
  const soon = entries.filter((e) => {
    const at = new Date(e.availableAt).getTime()
    return e.status === 'posted' && e.amountPoints > 0 && at > now.getTime() && at < endOfTomorrow
  })
  return { points: soon.reduce((s, e) => s + e.amountPoints, 0), count: soon.length }
}
