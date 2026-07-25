/**
 * Every number a business person might want to change lives here and nowhere
 * else. These are the defaults that seed the `settings` table; at runtime the
 * table wins, and each change bumps the global config version that gets
 * stamped onto ledger entries and completions.
 */

export type SettingsShape = {
  // --- points economy ----------------------------------------------------

  /**
   * How many points one US dollar of *user-facing value* is worth.
   * 1000 => the user sees "1,000 points" for $1.00.
   *
   * Large numbers are the convention in this category for a reason: "you
   * earned 850 points" reads better than "you earned $0.85", and it decouples
   * the display from any one payout currency.
   */
  points_per_usd: number

  /** Our default cut in basis points. 3500 = we keep 35%, user gets 65%. */
  default_revenue_share_bps: number

  /**
   * If the user is owed anything above zero, award at least this much. Without
   * it, a $0.003 screenout floors to 0 points and the user believes they were
   * cheated — which costs more in support volume than the points do in margin.
   */
  min_award_points: number

  // --- holds and redemption ---------------------------------------------

  /**
   * How long earned points sit non-withdrawable. Offer walls claw back 5-15%
   * of revenue days after crediting; a zero hold means every reversal lands
   * after the cash is gone.
   */
  hold_window_hours_offer_wall: number
  hold_window_hours_survey_wall: number

  min_redemption_points: number

  /** First payout for any account always goes to manual review. */
  review_first_payout: boolean

  /** Any payout at or above this goes to manual review regardless of history. */
  review_payout_above_points: number

  // --- growth -----------------------------------------------------------

  /** Paid to the referrer once the referee first earns, not at signup. */
  referral_bonus_points: number
  /** Referrer's ongoing cut of referee earnings, in basis points. Paid by us. */
  referral_commission_bps: number

  daily_bonus_base_points: number
  daily_bonus_streak_bonus_points: number
  daily_bonus_max_streak_days: number

  // --- fraud ------------------------------------------------------------

  /** Cumulative score at or above which a subject goes to manual review. */
  fraud_review_score: number
  /** Cumulative score at or above which a subject is denied outright. */
  fraud_deny_score: number

  /**
   * What to do when a check errors or a third-party signal provider is down.
   *
   * 'open'   -> treat as allow. Credits keep flowing during an outage, and
   *             fraud flows with them.
   * 'closed' -> treat as review. Nothing slips through, and a buggy check
   *             floods the review queue with legitimate users.
   *
   * This is a risk-appetite decision, not a technical one.
   */
  fraud_fail_mode: 'open' | 'closed'

  max_completions_per_user_per_hour: number
  max_completions_per_ip_per_hour: number
  max_signups_per_ip_per_day: number

  /**
   * What happens when a network claws back a completion after the user has
   * already cashed out.
   *
   * true  -> balance goes negative and recovers from future earnings. We keep
   *          the relationship and eventually the money, but the user sees a
   *          negative balance and often just leaves.
   * false -> balance floors at zero and we absorb the loss.
   */
  allow_negative_balance: boolean
}

export const DEFAULT_SETTINGS: SettingsShape = {
  points_per_usd: 1000,
  default_revenue_share_bps: 3500,
  min_award_points: 1,

  hold_window_hours_offer_wall: 72,
  hold_window_hours_survey_wall: 24,

  min_redemption_points: 500,
  review_first_payout: true,
  review_payout_above_points: 10_000,

  referral_bonus_points: 500,
  referral_commission_bps: 1000,

  daily_bonus_base_points: 10,
  daily_bonus_streak_bonus_points: 5,
  daily_bonus_max_streak_days: 7,

  fraud_review_score: 50,
  fraud_deny_score: 90,
  fraud_fail_mode: 'closed',

  max_completions_per_user_per_hour: 25,
  max_completions_per_ip_per_hour: 40,
  max_signups_per_ip_per_day: 5,

  allow_negative_balance: false,
}

export const SETTING_DESCRIPTIONS: Record<keyof SettingsShape, string> = {
  points_per_usd: 'Points shown to the user per $1.00 of user-facing value.',
  default_revenue_share_bps: 'Our cut in basis points when a network has no override.',
  min_award_points: 'Floor for any non-zero award, so tiny screenouts never award 0.',
  hold_window_hours_offer_wall: 'Hours before offer-wall points become withdrawable.',
  hold_window_hours_survey_wall: 'Hours before survey-wall points become withdrawable.',
  min_redemption_points: 'Minimum balance a user can cash out.',
  review_first_payout: "Send every account's first payout to manual review.",
  review_payout_above_points: 'Payouts at or above this always go to manual review.',
  referral_bonus_points: 'One-off bonus to the referrer once the referee first earns.',
  referral_commission_bps: 'Referrer commission on referee earnings, in basis points.',
  daily_bonus_base_points: 'Points for claiming the daily bonus on day one of a streak.',
  daily_bonus_streak_bonus_points: 'Extra points added per consecutive streak day.',
  daily_bonus_max_streak_days: 'Streak day at which the daily bonus stops growing.',
  fraud_review_score: 'Fraud score at or above which a subject goes to manual review.',
  fraud_deny_score: 'Fraud score at or above which a subject is denied.',
  fraud_fail_mode: "Behaviour when a fraud check errors: 'open' or 'closed'.",
  max_completions_per_user_per_hour: 'Per-user completion velocity cap.',
  max_completions_per_ip_per_hour: 'Per-IP completion velocity cap.',
  max_signups_per_ip_per_day: 'Per-IP signup velocity cap.',
  allow_negative_balance: 'Allow balance below zero after a post-payout clawback.',
}
