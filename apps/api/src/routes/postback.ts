import type { FastifyInstance, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { networks, postbackEvents } from '@app/db/schema'
import { PostbackParseError, queueJobId, type RawPostback } from '@app/core'
import type { AppContext } from '../context'
import { POSTBACK_QUEUE } from '../context'

/**
 * Generic postback ingestion.
 *
 * The contract with every network is the same: acknowledge fast, do nothing
 * expensive here. Networks retry aggressively when they do not receive a
 * prompt 200, and each retry is another duplicate to deduplicate. So this
 * endpoint verifies the signature, writes an audit row, enqueues, and returns.
 * All real work happens in the worker.
 *
 * It returns 200 even for events it refuses. A network that receives a 500
 * will retry the same bad payload forever; a network that receives a 200 has
 * been told "received", which is true — we received it and decided not to act.
 * The refusal is recorded in `postback_events` for us, not for them.
 */
export async function registerPostbackRoutes(app: FastifyInstance, ctx: AppContext) {
  const handler = async (request: FastifyRequest<{ Params: { networkKey: string } }>) => {
    const started = process.hrtime.bigint()
    const networkKey = request.params.networkKey

    const rawQueryString = (request.raw.url ?? '').split('?')[1] ?? ''
    const raw: RawPostback = {
      method: request.method,
      path: request.url.split('?')[0] ?? '',
      query: request.query as Record<string, string>,
      rawQueryString,
      headers: request.headers as Record<string, string>,
      // Preserved byte-exact by the content-type parser in server.ts. Most
      // networks sign raw bytes; re-serialising JSON changes key order and
      // whitespace and breaks signatures in ways that look like credential
      // problems for days.
      rawBody: (request as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0),
      remoteIp: request.ip,
    }

    const elapsed = () => Number(process.hrtime.bigint() - started) / 1_000_000

    const [network] = await ctx.db.select().from(networks).where(eq(networks.key, networkKey)).limit(1)

    if (!network || !network.enabled) {
      await ctx.db.insert(postbackEvents).values({
        networkKeyRaw: networkKey,
        remoteIp: raw.remoteIp,
        method: raw.method,
        path: raw.path,
        queryString: rawQueryString,
        headers: raw.headers,
        rawBody: raw.rawBody,
        parseStatus: 'unknown_network',
        parseError: network ? 'network is disabled' : 'no such network',
        dedupeOutcome: 'invalid',
        handledInMs: Math.round(elapsed()),
      })
      return { ok: true, accepted: false }
    }

    const adapter = ctx.adapters.get(network.key)
    if (!adapter) {
      await ctx.db.insert(postbackEvents).values({
        networkId: network.id,
        networkKeyRaw: networkKey,
        remoteIp: raw.remoteIp,
        method: raw.method,
        path: raw.path,
        queryString: rawQueryString,
        headers: raw.headers,
        rawBody: raw.rawBody,
        parseStatus: 'unknown_network',
        parseError: `no adapter registered for ${network.key}`,
        dedupeOutcome: 'invalid',
        handledInMs: Math.round(elapsed()),
      })
      return { ok: true, accepted: false }
    }

    const adapterCtx = ctx.adapters.contextFor(
      { key: network.key, config: network.config, secretRef: network.secretRef },
      ctx.log,
    )

    const verification = adapter.verifyPostback(raw, adapterCtx)
    if (!verification.ok) {
      await ctx.db.insert(postbackEvents).values({
        networkId: network.id,
        networkKeyRaw: networkKey,
        remoteIp: raw.remoteIp,
        method: raw.method,
        path: raw.path,
        queryString: rawQueryString,
        headers: raw.headers,
        rawBody: raw.rawBody,
        signatureValid: false,
        parseStatus: 'bad_signature',
        parseError: verification.reason,
        dedupeOutcome: 'invalid',
        handledInMs: Math.round(elapsed()),
      })
      ctx.log('postback rejected: bad signature', { networkKey, reason: verification.reason })
      return { ok: true, accepted: false }
    }

    let completion
    try {
      completion = adapter.parsePostback(raw, adapterCtx)
    } catch (error) {
      const message = error instanceof PostbackParseError ? error.message : String(error)
      await ctx.db.insert(postbackEvents).values({
        networkId: network.id,
        networkKeyRaw: networkKey,
        remoteIp: raw.remoteIp,
        method: raw.method,
        path: raw.path,
        queryString: rawQueryString,
        headers: raw.headers,
        rawBody: raw.rawBody,
        signatureValid: true,
        parseStatus: 'malformed',
        parseError: message,
        dedupeOutcome: 'invalid',
        handledInMs: Math.round(elapsed()),
      })
      ctx.log('postback rejected: malformed', { networkKey, error: message })
      return { ok: true, accepted: false }
    }

    /**
     * Deduplicate at the queue as well as at the database.
     *
     * BullMQ ignores a job whose id already exists, so a four-deep retry storm
     * produces one job instead of four. The unique index on `completions` is
     * still the actual guarantee — this only avoids doing the work four times
     * and finding out three of them were wasted.
     */
    const jobId = queueJobId(
      network.key,
      completion.externalTransactionId,
      completion.kind,
      completion.reversalEventId,
    )

    const [event] = await ctx.db
      .insert(postbackEvents)
      .values({
        networkId: network.id,
        networkKeyRaw: networkKey,
        remoteIp: raw.remoteIp,
        method: raw.method,
        path: raw.path,
        queryString: rawQueryString,
        headers: raw.headers,
        rawBody: raw.rawBody,
        signatureValid: true,
        parseStatus: 'ok',
        dedupeOutcome: 'new',
        handledInMs: Math.round(elapsed()),
      })
      .returning({ id: postbackEvents.id })

    await ctx.postbackQueue.add(
      'process-completion',
      {
        networkId: network.id,
        networkKey: network.key,
        postbackEventId: event!.id,
        completion: {
          ...completion,
          occurredAt: completion.occurredAt?.toISOString(),
        },
      },
      {
        jobId,
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      },
    )

    await ctx.db
      .update(networks)
      .set({ lastPostbackAt: new Date() })
      .where(eq(networks.id, network.id))

    return { ok: true, accepted: true }
  }

  // Offer walls typically GET; survey walls sometimes POST. Both supported.
  app.get('/postback/:networkKey', handler)
  app.post('/postback/:networkKey', handler)
}
