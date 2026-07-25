import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { eq, sql } from 'drizzle-orm'
import { createDb } from '@app/db'
import { networks, offers, payouts, postbackEvents } from '@app/db/schema'
import {
  AdapterRegistry,
  CompletionProcessor,
  FraudPipeline,
  LedgerService,
  MockPayoutProvider,
  PayoutService,
  SettingsService,
  awardPoints,
  queueJobId,
  type CanonicalCompletion,
} from '@app/core'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set')
const USER_TOKEN_SECRET = process.env.USER_TOKEN_SECRET
if (!USER_TOKEN_SECRET) throw new Error('USER_TOKEN_SECRET is not set')

const db = createDb(DATABASE_URL)
const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
  maxRetriesPerRequest: null,
})

const log = (message: string, meta?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), message, ...meta }))

const settingsService = new SettingsService(db)
await settingsService.seedDefaults()

const adapters = new AdapterRegistry()
const fraud = new FraudPipeline()
const provider = new MockPayoutProvider()

/**
 * Settings are re-read per job rather than captured once at boot.
 *
 * A worker can stay up for weeks. If an admin changes the conversion rate or a
 * fraud threshold, jobs processed after that change must use the new value and
 * stamp the new config version, or the ledger records a price that no longer
 * matches what anyone believes.
 */
const services = async () => {
  const { values: settings, version: configVersion } = await settingsService.get()
  const ledger = new LedgerService(db, { allowNegativeBalance: settings.allow_negative_balance })
  return {
    settings,
    configVersion,
    ledger,
    processor: new CompletionProcessor(db, {
      ledger,
      fraud,
      settings,
      configVersion,
      userTokenSecret: USER_TOKEN_SECRET,
      log,
    }),
    payoutService: new PayoutService(db, {
      ledger,
      provider,
      fraud,
      settings,
      configVersion,
      destinationSecret: USER_TOKEN_SECRET,
      log,
    }),
  }
}

// --- postbacks --------------------------------------------------------------

const postbackWorker = new Worker(
  'postbacks',
  async (job) => {
    const { networkId, networkKey, postbackEventId, completion } = job.data as {
      networkId: string
      networkKey: string
      postbackEventId: string
      completion: CanonicalCompletion & { occurredAt?: string }
    }

    const { processor } = await services()

    const outcome = await processor.process({
      networkId,
      networkKey,
      completion: {
        ...completion,
        ...(completion.occurredAt ? { occurredAt: new Date(completion.occurredAt) } : {}),
      },
    })

    // Link the audit row to what it became, so a support lookup by transaction
    // id can walk raw bytes -> completion -> ledger entry in one hop.
    if (outcome.completionId) {
      await db
        .update(postbackEvents)
        .set({
          completionId: outcome.completionId,
          dedupeOutcome: outcome.status === 'duplicate' ? 'duplicate' : 'new',
        })
        .where(eq(postbackEvents.id, postbackEventId))
    }

    log('postback processed', { networkKey, ...outcome })
    return outcome
  },
  { connection, concurrency: 8 },
)

// --- payouts ----------------------------------------------------------------

const payoutWorker = new Worker(
  'payouts',
  async (job) => {
    const { payoutService } = await services()

    if (job.name === 'settle') {
      const { payoutId } = job.data as { payoutId: string }
      const state = await payoutService.settle(payoutId)
      log('payout settle attempted', { payoutId, state })

      // Providers settle asynchronously. Schedule a poll rather than blocking.
      if (state === 'processing') {
        await payoutQueue.add('poll', { payoutId }, { delay: 10_000, attempts: 20 })
      }
      return { state }
    }

    if (job.name === 'poll') {
      const { payoutId } = job.data as { payoutId: string }
      const state = await payoutService.pollStatus(payoutId)
      log('payout polled', { payoutId, state })
      if (state === 'processing') {
        await payoutQueue.add('poll', { payoutId }, { delay: 30_000, attempts: 20 })
      }
      return { state }
    }

    return null
  },
  { connection, concurrency: 4 },
)

const payoutQueue = new Queue('payouts', { connection })

// --- catalog sync -----------------------------------------------------------

/**
 * Pull each offer-wall catalog into our own store.
 *
 * The feed reads from `offers`, never from a network's API, so a network being
 * down means stale inventory rather than an empty page. Survey walls are
 * skipped: they have no catalog, and the placement URL is built per request.
 */
async function syncCatalogs(): Promise<void> {
  const { values: settings, version: configVersion } = await settingsService.get()
  const enabled = await db.select().from(networks).where(eq(networks.enabled, true))

  for (const network of enabled) {
    const adapter = adapters.get(network.key)
    if (!adapter?.capabilities.catalog || !adapter.fetchOffers) continue

    const ctx = adapters.contextFor(
      { key: network.key, config: network.config, secretRef: network.secretRef },
      log,
    )

    try {
      const fetched = await adapter.fetchOffers(ctx)
      let upserted = 0

      for (const offer of fetched) {
        const points = awardPoints({
          grossUsdMicros: offer.grossUsdMicros,
          revenueShareBps: network.revenueShareBps,
          pointsPerUsd: settings.points_per_usd,
          minAwardPoints: settings.min_award_points,
        })

        await db
          .insert(offers)
          .values({
            networkId: network.id,
            externalOfferId: offer.externalOfferId,
            title: offer.title,
            description: offer.description ?? null,
            requirements: offer.requirements ?? null,
            category: offer.category,
            iconUrl: offer.iconUrl ?? null,
            grossUsdMicros: offer.grossUsdMicros,
            points,
            configVersion,
            urlTemplate: offer.urlTemplate,
            countries: offer.countries ?? null,
            excludedCountries: offer.excludedCountries ?? null,
            devices: offer.devices ?? null,
            estimatedMinutes: offer.estimatedMinutes ?? null,
            isActive: true,
            raw: offer.raw as Record<string, unknown>,
          })
          .onConflictDoUpdate({
            target: [offers.networkId, offers.externalOfferId],
            set: {
              title: offer.title,
              description: offer.description ?? null,
              grossUsdMicros: offer.grossUsdMicros,
              points,
              configVersion,
              urlTemplate: offer.urlTemplate,
              countries: offer.countries ?? null,
              devices: offer.devices ?? null,
              isActive: true,
              lastSeenAt: sql`now()`,
            },
          })
        upserted += 1
      }

      /**
       * Anything not seen in this sync is deactivated rather than deleted.
       * A completion can still arrive for an offer that left the catalog an
       * hour ago, and we need the row to explain what the user did.
       */
      await db.execute(sql`
        UPDATE offers SET is_active = false
        WHERE network_id = ${network.id}
          AND last_seen_at < now() - interval '5 minutes'
          AND is_active = true
      `)

      await db.update(networks).set({ lastSyncedAt: sql`now()` }).where(eq(networks.id, network.id))
      log('catalog synced', { network: network.key, offers: upserted })
    } catch (error) {
      log('catalog sync failed', {
        network: network.key,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

// --- maintenance ------------------------------------------------------------

const maintenanceQueue = new Queue('maintenance', { connection })

const maintenanceWorker = new Worker(
  'maintenance',
  async (job) => {
    if (job.name === 'sync-catalogs') {
      await syncCatalogs()
      return { ok: true }
    }

    if (job.name === 'reconcile-reversals') {
      const { processor } = await services()
      const result = await processor.reconcileOrphanReversals()
      if (result.applied > 0) log('reconciled out-of-order reversals', result)
      return result
    }

    if (job.name === 'poll-stuck-payouts') {
      // Belt and braces: a scheduled poll job can be lost if Redis is flushed.
      // This sweeps anything left in `processing` and re-queues it.
      const stuck = await db
        .select({ id: payouts.id })
        .from(payouts)
        .where(eq(payouts.state, 'processing'))
        .limit(100)

      for (const p of stuck) {
        await payoutQueue.add(
          'poll',
          { payoutId: p.id },
          { jobId: queueJobId('poll', p.id, String(Date.now())) },
        )
      }
      return { requeued: stuck.length }
    }

    return null
  },
  { connection, concurrency: 1 },
)

await maintenanceQueue.add(
  'sync-catalogs',
  {},
  { repeat: { every: 15 * 60_000 }, jobId: 'sync-catalogs' },
)
await maintenanceQueue.add(
  'poll-stuck-payouts',
  {},
  { repeat: { every: 5 * 60_000 }, jobId: 'poll-stuck-payouts' },
)
// Frequent, because until this runs a user is holding points the network has
// already clawed back.
await maintenanceQueue.add(
  'reconcile-reversals',
  {},
  { repeat: { every: 60_000 }, jobId: 'reconcile-reversals' },
)

// Run once at boot so a fresh database has inventory immediately.
await syncCatalogs()

for (const [name, worker] of [
  ['postbacks', postbackWorker],
  ['payouts', payoutWorker],
  ['maintenance', maintenanceWorker],
] as const) {
  worker.on('failed', (job, error) => {
    log('job failed', { queue: name, jobId: job?.id, error: error.message })
  })
}

log('worker started', { queues: ['postbacks', 'payouts', 'maintenance'] })

const shutdown = async () => {
  await Promise.all([postbackWorker.close(), payoutWorker.close(), maintenanceWorker.close()])
  await connection.quit()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
