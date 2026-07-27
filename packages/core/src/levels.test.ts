import { describe, expect, it } from 'vitest'
import { LEVELS, holdHoursFor, levelFor, minRedemptionFor } from './levels'

describe('levels', () => {
  it('starts everyone at level 1 with no discount', () => {
    const state = levelFor(0)
    expect(state.current.level).toBe(1)
    expect(holdHoursFor(72, 0)).toBe(72)
    expect(minRedemptionFor(5_000, 0)).toBe(5_000)
  })

  it('never goes backwards as lifetime earnings grow', () => {
    let previous = 0
    for (let earned = 0; earned <= 200_000; earned += 2_500) {
      const level = levelFor(earned).current.level
      expect(level).toBeGreaterThanOrEqual(previous)
      previous = level
    }
  })

  it('makes each level strictly better than the one below', () => {
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i]!.holdMultiplier).toBeLessThanOrEqual(LEVELS[i - 1]!.holdMultiplier)
      expect(LEVELS[i]!.minRedemptionMultiplier).toBeLessThanOrEqual(
        LEVELS[i - 1]!.minRedemptionMultiplier,
      )
    }
  })

  it('clears instantly at the top level', () => {
    expect(holdHoursFor(72, 150_000)).toBe(0)
  })

  it('rounds the minimum to a number a user can repeat out loud', () => {
    // Not ₹387.40. Whole hundreds of points, which is whole tens of rupees.
    for (const earned of [0, 12_000, 40_000, 90_000, 500_000]) {
      expect(minRedemptionFor(5_000, earned) % 100).toBe(0)
    }
  })

  it('never lets the minimum fall to something unpayable', () => {
    expect(minRedemptionFor(100, 999_999)).toBeGreaterThanOrEqual(100)
  })

  it('reports progress that reaches the next threshold at exactly 1', () => {
    const second = LEVELS[1]!
    const justBelow = levelFor(second.threshold - 1)
    expect(justBelow.progress).toBeGreaterThan(0.9)
    expect(justBelow.toNext).toBe(1)

    const exactly = levelFor(second.threshold)
    expect(exactly.current.level).toBe(2)
  })

  it('treats a negative balance as zero rather than throwing', () => {
    expect(levelFor(-5_000).current.level).toBe(1)
  })
})
