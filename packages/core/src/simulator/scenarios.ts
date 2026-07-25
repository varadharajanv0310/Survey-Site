import { createHash, createHmac } from 'node:crypto'

/**
 * An adversarial network simulator.
 *
 * Seeded mock data proves the screens render. It proves nothing about whether
 * the pipeline is correct, because the interesting cases never appear in a
 * happy-path fixture. This generates what a real offer wall actually does on a
 * bad day:
 *
 *   - the same postback four times, because it did not see our 200 quickly
 *   - a reversal three days after the credit, reusing the transaction id
 *   - a reversal that arrives BEFORE the credit it reverses, because their
 *     queue is out of order
 *   - screenouts worth fractions of a cent
 *   - a payload with the amount missing
 *   - a request signed with the wrong secret
 *   - a completion for a user token that does not resolve
 *   - a user token with a tampered signature, which is the actual attack
 *   - two partial clawbacks against one transaction
 *
 * If the pipeline survives all of this, connecting a real network is a row in
 * the `networks` table. If we only ever test the happy path, the first real
 * network teaches us these cases with real money and real support tickets.
 */

export type SimulatedRequest = {
  scenario: string
  description: string
  networkKey: string
  query: Record<string, string>
  /** What the pipeline should do. Used to assert, not just to eyeball logs. */
  expect:
    | 'credit'
    | 'screenout'
    | 'reversal'
    | 'duplicate'
    | 'rejected_signature'
    | 'rejected_malformed'
    | 'rejected_unknown_user'
  /** Milliseconds to wait before sending, for ordering scenarios. */
  delayMs?: number
}

export type SimulatorOptions = {
  offerWallSecret: string
  surveyWallSecret: string
  /** Valid signed tokens for real seeded users. */
  userTokens: string[]
  /** A token whose signature does not verify. */
  tamperedToken: string
  /** A well-signed token for a user that no longer exists. */
  orphanToken: string
}

let seq = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`

const signOfferWall = (transactionId: string, secret: string) =>
  createHash('md5').update(`${transactionId}${secret}`).digest('hex')

const signSurveyWall = (query: Record<string, string>, secret: string) => {
  const signable = Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return createHmac('sha256', secret).update(signable).digest('hex')
}

const surveyWallRequest = (
  base: Record<string, string>,
  secret: string,
  opts: { corruptSignature?: boolean } = {},
): Record<string, string> => {
  const signature = signSurveyWall(base, secret)
  return {
    ...base,
    secure_hash: opts.corruptSignature ? signature.split('').reverse().join('') : signature,
  }
}

export function buildScenarios(opts: SimulatorOptions): SimulatedRequest[] {
  const requests: SimulatedRequest[] = []
  const user = (i: number) => opts.userTokens[i % opts.userTokens.length]!

  // --- 1. the ordinary case -------------------------------------------------
  {
    const txId = nextId('ow')
    requests.push({
      scenario: 'happy_credit',
      description: 'A clean offer-wall completion.',
      networkKey: 'sim_offer_wall',
      expect: 'credit',
      query: {
        transaction_id: txId,
        sub_id: user(0),
        offer_id: 'sow-1003',
        payout: '12.50',
        status: '1',
        timestamp: String(Math.floor(Date.now() / 1000)),
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
  }

  // --- 2. retries -----------------------------------------------------------
  {
    const txId = nextId('ow-retry')
    const query = {
      transaction_id: txId,
      sub_id: user(1),
      offer_id: 'sow-1001',
      payout: '4.20',
      status: '1',
      signature: signOfferWall(txId, opts.offerWallSecret),
    }
    requests.push({
      scenario: 'retry_storm',
      description: 'The network did not see our 200 and sent the same event four times.',
      networkKey: 'sim_offer_wall',
      expect: 'credit',
      query,
    })
    for (let i = 0; i < 3; i += 1) {
      requests.push({
        scenario: 'retry_storm',
        description: `Retry ${i + 1} of the same transaction. Must not credit again.`,
        networkKey: 'sim_offer_wall',
        expect: 'duplicate',
        query: { ...query },
      })
    }
  }

  // --- 3. the late clawback -------------------------------------------------
  {
    const txId = nextId('ow-claw')
    requests.push({
      scenario: 'late_reversal',
      description: 'Credit now.',
      networkKey: 'sim_offer_wall',
      expect: 'credit',
      query: {
        transaction_id: txId,
        sub_id: user(2),
        offer_id: 'sow-1005',
        payout: '8.00',
        status: '1',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
    requests.push({
      scenario: 'late_reversal',
      description: 'Same transaction id, clawed back. Standard chargeback behaviour.',
      networkKey: 'sim_offer_wall',
      expect: 'reversal',
      delayMs: 400,
      query: {
        transaction_id: txId,
        sub_id: user(2),
        offer_id: 'sow-1005',
        payout: '8.00',
        status: '2',
        reversal_id: 'rev-1',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
  }

  // --- 4. two partial clawbacks against one transaction ---------------------
  {
    const txId = nextId('ow-partial')
    requests.push({
      scenario: 'partial_clawbacks',
      description: 'Credit $12.50.',
      networkKey: 'sim_offer_wall',
      expect: 'credit',
      query: {
        transaction_id: txId,
        sub_id: user(3),
        offer_id: 'sow-1003',
        payout: '12.50',
        status: '1',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
    requests.push({
      scenario: 'partial_clawbacks',
      description: 'Claw back $5.00 of it.',
      networkKey: 'sim_offer_wall',
      expect: 'reversal',
      delayMs: 200,
      query: {
        transaction_id: txId,
        sub_id: user(3),
        payout: '5.00',
        status: '2',
        reversal_id: 'rev-a',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
    requests.push({
      scenario: 'partial_clawbacks',
      description:
        'Claw back another $4.00. Distinct reversal id, so this must NOT deduplicate against the first.',
      networkKey: 'sim_offer_wall',
      expect: 'reversal',
      delayMs: 200,
      query: {
        transaction_id: txId,
        sub_id: user(3),
        payout: '4.00',
        status: '2',
        reversal_id: 'rev-b',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
  }

  // --- 5. reversal arriving before its credit -------------------------------
  {
    const txId = nextId('ow-ooo')
    requests.push({
      scenario: 'out_of_order',
      description: 'A reversal for a transaction we have never seen. Their queue is out of order.',
      networkKey: 'sim_offer_wall',
      expect: 'reversal',
      query: {
        transaction_id: txId,
        sub_id: user(4),
        payout: '3.00',
        status: '2',
        reversal_id: 'rev-early',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
    requests.push({
      scenario: 'out_of_order',
      description: 'The credit it referred to, arriving second.',
      networkKey: 'sim_offer_wall',
      expect: 'credit',
      delayMs: 300,
      query: {
        transaction_id: txId,
        sub_id: user(4),
        payout: '3.00',
        status: '1',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
  }

  // --- 6. survey wall: completions and the far more common screenout --------
  {
    const txId = nextId('sw')
    requests.push({
      scenario: 'survey_complete',
      description: 'A completed survey.',
      networkKey: 'sim_survey_wall',
      expect: 'credit',
      query: surveyWallRequest(
        {
          trans_id: txId,
          ext_user_id: user(0),
          survey_id: 'srv-88',
          amount_usd: '1.35',
          status: '1',
        },
        opts.surveyWallSecret,
      ),
    })
  }
  for (let i = 0; i < 4; i += 1) {
    const txId = nextId('sw-so')
    requests.push({
      scenario: 'screenout',
      description: 'Screened out after two questions. Worth a fraction of a cent.',
      networkKey: 'sim_survey_wall',
      expect: 'screenout',
      query: surveyWallRequest(
        {
          trans_id: txId,
          ext_user_id: user(i + 1),
          survey_id: `srv-${90 + i}`,
          amount_usd: '0.004',
          status: '2',
        },
        opts.surveyWallSecret,
      ),
    })
  }

  // --- 7. things that must be refused ---------------------------------------
  {
    const txId = nextId('ow-badsig')
    requests.push({
      scenario: 'bad_signature',
      description: 'Signed with the wrong secret. Must never credit.',
      networkKey: 'sim_offer_wall',
      expect: 'rejected_signature',
      query: {
        transaction_id: txId,
        sub_id: user(0),
        payout: '99.00',
        status: '1',
        signature: signOfferWall(txId, 'definitely-not-the-secret'),
      },
    })
  }
  {
    const txId = nextId('sw-badsig')
    requests.push({
      scenario: 'bad_signature',
      description: 'Survey wall signature corrupted in transit.',
      networkKey: 'sim_survey_wall',
      expect: 'rejected_signature',
      query: surveyWallRequest(
        {
          trans_id: txId,
          ext_user_id: user(0),
          amount_usd: '50.00',
          status: '1',
        },
        opts.surveyWallSecret,
        { corruptSignature: true },
      ),
    })
  }
  {
    const txId = nextId('ow-malformed')
    requests.push({
      scenario: 'malformed',
      description: 'Correctly signed but the payout field is missing.',
      networkKey: 'sim_offer_wall',
      expect: 'rejected_malformed',
      query: {
        transaction_id: txId,
        sub_id: user(0),
        status: '1',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
  }
  {
    const txId = nextId('ow-tampered')
    requests.push({
      scenario: 'tampered_user_token',
      description:
        'Valid network signature, but the user token signature does not verify. This is the ' +
        'actual attack: crediting someone else by editing sub_id in the URL.',
      networkKey: 'sim_offer_wall',
      expect: 'rejected_unknown_user',
      query: {
        transaction_id: txId,
        sub_id: opts.tamperedToken,
        payout: '25.00',
        status: '1',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
  }
  {
    const txId = nextId('ow-orphan')
    requests.push({
      scenario: 'unknown_user',
      description: 'Correctly signed token for an account that no longer exists.',
      networkKey: 'sim_offer_wall',
      expect: 'rejected_unknown_user',
      query: {
        transaction_id: txId,
        sub_id: opts.orphanToken,
        payout: '2.00',
        status: '1',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
  }

  // --- 8. velocity: one user completing far too much, far too fast ----------
  for (let i = 0; i < 12; i += 1) {
    const txId = nextId('ow-burst')
    requests.push({
      scenario: 'velocity_burst',
      description: `Burst completion ${i + 1}/12 from one account. Should trip the rate cap.`,
      networkKey: 'sim_offer_wall',
      expect: 'credit',
      query: {
        transaction_id: txId,
        sub_id: user(0),
        offer_id: 'sow-1004',
        payout: '0.85',
        status: '1',
        signature: signOfferWall(txId, opts.offerWallSecret),
      },
    })
  }

  return requests
}
