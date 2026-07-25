import { pgEnum } from 'drizzle-orm/pg-core'

// --- identity -------------------------------------------------------------

export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'banned'])

export const authEventKindEnum = pgEnum('auth_event_kind', [
  'signup',
  'login',
  'login_failed',
  'logout',
  'password_reset_requested',
  'password_reset_completed',
  'email_verified',
])

export const deviceTypeEnum = pgEnum('device_type', ['desktop', 'mobile', 'tablet'])

export const adminRoleEnum = pgEnum('admin_role', ['viewer', 'reviewer', 'superadmin'])

export const actorTypeEnum = pgEnum('actor_type', ['user', 'admin', 'system', 'provider'])

// --- supply ---------------------------------------------------------------

/**
 * Survey walls (CPX Research, BitLabs, Pollfish, TheoremReach) are iframes:
 * there is no catalog to sync, we render a signed URL and their JS decides
 * what to show. Offer walls (AdGate, Torox, Adscend, Lootably, ayeT) expose a
 * real catalog API we pull and store. They are different products and do not
 * share a row shape — see `wallPlacements` vs `offers`.
 */
export const networkKindEnum = pgEnum('network_kind', ['survey_wall', 'offer_wall'])

export const offerCategoryEnum = pgEnum('offer_category', [
  'survey',
  'app_install',
  'signup',
  'purchase',
  'game',
  'video',
  'other',
])

// --- ingestion ------------------------------------------------------------

/**
 * `screenout` is not an edge case. Users are disqualified from 60-80% of
 * survey attempts, and walls pay a small consolation amount for it. A model
 * that only understands 'completed' has nowhere to put the most common event
 * in the system.
 */
export const completionKindEnum = pgEnum('completion_kind', ['credit', 'screenout', 'reversal'])

export const completionStatusEnum = pgEnum('completion_status', [
  'received',
  'pending_review',
  'credited',
  'rejected',
  'reversed',
])

export const postbackParseStatusEnum = pgEnum('postback_parse_status', [
  'ok',
  'unknown_network',
  'bad_signature',
  'malformed',
  'unknown_user',
])

export const postbackDedupeOutcomeEnum = pgEnum('postback_dedupe_outcome', [
  'new',
  'duplicate',
  'invalid',
])

// --- money ----------------------------------------------------------------

export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
  'earn',
  'screenout',
  'reversal',
  'redeem',
  'redeem_refund',
  'manual_adjustment',
  'bonus',
  'referral_bonus',
  'referral_commission',
])

export const ledgerEntryStatusEnum = pgEnum('ledger_entry_status', [
  'pending',
  'posted',
  'rejected',
  'void',
])

export const payoutStateEnum = pgEnum('payout_state', [
  'requested',
  'under_review',
  'approved',
  'processing',
  'paid',
  'failed',
  'cancelled',
])

export const payoutMethodEnum = pgEnum('payout_method', ['paypal', 'upi', 'giftcard', 'crypto'])

// --- fraud ----------------------------------------------------------------

/**
 * `unavailable` is a real verdict, not an error. When IPQS is down or a check
 * throws, the pipeline needs to record that it could not form an opinion and
 * apply the configured fail mode, rather than silently reporting 'allow'.
 */
export const fraudVerdictEnum = pgEnum('fraud_verdict', ['allow', 'review', 'deny', 'unavailable'])

export const fraudSubjectTypeEnum = pgEnum('fraud_subject_type', [
  'signup',
  'login',
  'completion',
  'payout',
])

export const reviewStateEnum = pgEnum('review_state', ['open', 'resolved'])

export const reviewResolutionEnum = pgEnum('review_resolution', ['allow', 'deny'])

// --- support --------------------------------------------------------------

export const ticketKindEnum = pgEnum('ticket_kind', [
  'missing_points',
  'payout_issue',
  'account',
  'other',
])

export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'awaiting_user',
  'resolved',
  'closed',
])
