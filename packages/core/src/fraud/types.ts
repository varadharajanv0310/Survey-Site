import type { Database } from '@app/db'
import type { SettingsShape } from '../config/settings'

export type FraudVerdict = 'allow' | 'review' | 'deny' | 'unavailable'

export type FraudSubjectType = 'signup' | 'login' | 'completion' | 'payout'

export type FraudSubject =
  | {
      type: 'signup'
      userId: string
      email: string
      ip?: string | undefined
      userAgent?: string | undefined
      deviceFingerprint?: string | undefined
    }
  | {
      type: 'login'
      userId: string
      ip?: string | undefined
      deviceFingerprint?: string | undefined
    }
  | {
      type: 'completion'
      completionId: string
      userId: string
      networkId: string
      grossUsdMicros: number
      pointsAwarded: number
      ip?: string | undefined
      userAgent?: string | undefined
    }
  | {
      type: 'payout'
      payoutId: string
      userId: string
      points: number
      destinationHash: string
      ip?: string | undefined
    }

export type FraudContext = {
  db: Database
  settings: SettingsShape
  configVersion: number
  log: (message: string, meta?: Record<string, unknown>) => void
}

export type CheckOutcome = {
  verdict: FraudVerdict
  /**
   * Added to the subject's running score. Positive means more suspicious.
   * Thresholds live in settings so tuning never requires a deploy.
   */
  scoreDelta: number
  details?: Record<string, unknown>
}

/**
 * A single, independently testable rule.
 *
 * Checks are read-only and time-bounded. They never write to the ledger, never
 * ban anyone, and never decide the outcome on their own — they contribute a
 * score and an opinion, and the pipeline decides. That separation is what lets
 * a rule be re-tuned against history rather than guessed at.
 */
export interface FraudCheck {
  readonly key: string
  readonly appliesTo: FraudSubjectType[]
  /** Milliseconds before the pipeline gives up on this check. */
  readonly timeoutMs?: number
  evaluate(subject: FraudSubject, ctx: FraudContext): Promise<CheckOutcome>
}

export type EvaluationResult = {
  evaluationId: string
  verdict: FraudVerdict
  score: number
  results: {
    checkKey: string
    verdict: FraudVerdict
    scoreDelta: number
    details?: Record<string, unknown>
    durationMs: number
    error?: string
  }[]
  durationMs: number
}
