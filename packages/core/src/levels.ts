/**
 * Levels, earned by lifetime points and spent on speed rather than on money.
 *
 * The Tempo direction is built around a level that raises your rate. In a
 * cashback app that is a cashback percentage; here the equivalent would be
 * raising the user's share of what the network pays us, which comes straight
 * out of margin and cannot be walked back once promised.
 *
 * So levels buy the two things users actually complain about instead: how long
 * points take to clear, and how much they must accumulate before cashing out.
 * Both cost us nothing per user and both are genuinely felt.
 *
 * This is enforced server-side — `holdHoursFor` and `minRedemptionFor` are
 * used by the completion processor and the payout service. A level shown in
 * the UI that the backend did not honour would be the exact species of lie
 * this product cannot afford.
 */

export type Level = {
  level: number
  name: string
  /** Lifetime posted points required to reach this level. */
  threshold: number
  /** Multiplier applied to the configured hold window. 1 = no change. */
  holdMultiplier: number
  /** Multiplier applied to the configured minimum redemption. */
  minRedemptionMultiplier: number
  perk: string
}

export const LEVELS: Level[] = [
  {
    level: 1,
    name: 'Starter',
    threshold: 0,
    holdMultiplier: 1,
    minRedemptionMultiplier: 1,
    perk: 'Standard clearing and minimum',
  },
  {
    level: 2,
    name: 'Regular',
    threshold: 10_000,
    holdMultiplier: 0.75,
    minRedemptionMultiplier: 0.8,
    perk: 'Points clear 25% faster',
  },
  {
    level: 3,
    name: 'Steady',
    threshold: 30_000,
    holdMultiplier: 0.5,
    minRedemptionMultiplier: 0.6,
    perk: 'Half the clearing wait, lower minimum',
  },
  {
    level: 4,
    name: 'Trusted',
    threshold: 75_000,
    holdMultiplier: 0.25,
    minRedemptionMultiplier: 0.4,
    perk: 'Most points clear same day',
  },
  {
    level: 5,
    name: 'Established',
    threshold: 150_000,
    holdMultiplier: 0,
    minRedemptionMultiplier: 0.3,
    perk: 'Points are withdrawable immediately',
  },
]

export type LevelState = {
  current: Level
  next: Level | null
  /** Lifetime points earned, the currency levels are bought with. */
  lifetimeEarned: number
  /** Points still needed to reach `next`. Zero at the top level. */
  toNext: number
  /** 0–1 progress through the current level. 1 at the top level. */
  progress: number
}

export function levelFor(lifetimeEarned: number): LevelState {
  const earned = Math.max(0, lifetimeEarned)

  let current = LEVELS[0]!
  for (const level of LEVELS) {
    if (earned >= level.threshold) current = level
  }

  const next = LEVELS.find((l) => l.level === current.level + 1) ?? null
  if (!next) {
    return { current, next: null, lifetimeEarned: earned, toNext: 0, progress: 1 }
  }

  const span = next.threshold - current.threshold
  const into = earned - current.threshold

  return {
    current,
    next,
    lifetimeEarned: earned,
    toNext: Math.max(0, next.threshold - earned),
    progress: span > 0 ? Math.min(1, into / span) : 1,
  }
}

/** Hold window for this user, after their level discount. */
export function holdHoursFor(baseHours: number, lifetimeEarned: number): number {
  const { current } = levelFor(lifetimeEarned)
  return Math.round(baseHours * current.holdMultiplier)
}

/**
 * Minimum redemption for this user, after their level discount.
 *
 * Rounded down to a whole 100 points (₹10) so the number a user sees is one
 * they can repeat to a friend, rather than ₹387.40.
 */
export function minRedemptionFor(basePoints: number, lifetimeEarned: number): number {
  const { current } = levelFor(lifetimeEarned)
  const discounted = basePoints * current.minRedemptionMultiplier
  return Math.max(100, Math.floor(discounted / 100) * 100)
}
