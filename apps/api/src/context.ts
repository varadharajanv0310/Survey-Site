import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { createDb, type Database } from '@app/db'
import {
  AdapterRegistry,
  AdminAuthService,
  AuthService,
  CompletionProcessor,
  FraudPipeline,
  LedgerService,
  MockPayoutProvider,
  PayoutService,
  SettingsService,
  createEmailProvider,
  type PayoutProvider,
} from '@app/core'

export const POSTBACK_QUEUE = 'postbacks'
export const PAYOUT_QUEUE = 'payouts'

export type AppContext = Awaited<ReturnType<typeof createContext>>

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export async function createContext() {
  const db: Database = createDb(required('DATABASE_URL'))
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380'

  // maxRetriesPerRequest must be null for BullMQ's blocking connections.
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })

  const settingsService = new SettingsService(db)
  await settingsService.seedDefaults()
  const { values: settings, version: configVersion } = await settingsService.get()

  const log = (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', message, ...meta }))
  }

  const ledger = new LedgerService(db, {
    allowNegativeBalance: settings.allow_negative_balance,
  })
  const fraud = new FraudPipeline()
  const adapters = new AdapterRegistry()

  /**
   * There are no real payout rails. `PAYOUT_PROVIDER` exists so that adding
   * one later is a config change, but the only implementation today is the
   * mock, and it does not move money.
   */
  const provider: PayoutProvider = new MockPayoutProvider()
  if (process.env.PAYOUT_PROVIDER && process.env.PAYOUT_PROVIDER !== 'mock') {
    throw new Error(
      `PAYOUT_PROVIDER=${process.env.PAYOUT_PROVIDER} is not implemented. ` +
        'Only the mock provider exists; no real payout integration has been built.',
    )
  }

  const userTokenSecret = required('USER_TOKEN_SECRET')

  const payoutService = new PayoutService(db, {
    ledger,
    provider,
    fraud,
    settings,
    configVersion,
    destinationSecret: userTokenSecret,
    log,
  })

  const completionProcessor = new CompletionProcessor(db, {
    ledger,
    fraud,
    settings,
    configVersion,
    userTokenSecret,
    log,
  })

  // Falls back to the console sender when RESEND_API_KEY is unset, and says so
  // rather than pretending mail went out.
  const email = createEmailProvider()

  const auth = new AuthService(db, {
    sendEmail: async (to, subject, body) => {
      const result = await email.send({ to, subject, text: body })
      if (!result.delivered) {
        log('email not delivered', { to, subject, reason: result.reason, provider: email.key })
      }
    },
  })

  const adminAuth = new AdminAuthService(db)

  const postbackQueue = new Queue(POSTBACK_QUEUE, { connection })
  const payoutQueue = new Queue(PAYOUT_QUEUE, { connection })

  return {
    db,
    connection,
    adminAuth,
    settingsService,
    settings,
    configVersion,
    ledger,
    fraud,
    adapters,
    provider,
    payoutService,
    completionProcessor,
    auth,
    postbackQueue,
    payoutQueue,
    userTokenSecret,
    log,
  }
}
