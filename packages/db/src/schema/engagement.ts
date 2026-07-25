import { index, inet, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createdAt } from './_shared'
import { users } from './identity'
import { networks, offers, wallPlacements } from './supply'

/**
 * Every time a user opens an offer or a survey wall.
 *
 * Without this, the most common support message in the category — "I completed
 * the offer and got nothing" — is unanswerable. We would know only that no
 * postback arrived, which cannot distinguish between:
 *
 *   - the user never actually started it
 *   - the user started it and the network never fired
 *   - the network fired and we rejected it
 *
 * The first is a conversation, the second is a claim to raise with the
 * network, and the third is our bug. Same symptom, three different responses.
 *
 * `userToken` is stored because it is the identifier the wall echoes back on
 * the postback, so a disputed transaction can be traced to the exact click.
 */
export const offerClicks = pgTable(
  'offer_clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    networkId: uuid('network_id')
      .notNull()
      .references(() => networks.id),
    /** Null for survey walls, which are a placement rather than an offer. */
    offerId: uuid('offer_id').references(() => offers.id),
    placementId: uuid('placement_id').references(() => wallPlacements.id),

    /** Denormalised so a click survives the offer leaving the catalog. */
    externalOfferId: text('external_offer_id'),
    offerTitle: text('offer_title'),

    userToken: text('user_token'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    deviceFingerprint: text('device_fingerprint'),

    createdAt: createdAt(),
  },
  (t) => [
    index('offer_clicks_user_idx').on(t.userId, t.createdAt),
    index('offer_clicks_offer_idx').on(t.offerId),
    index('offer_clicks_network_idx').on(t.networkId, t.createdAt),
    // Support looks up by the token that appeared in a disputed postback.
    index('offer_clicks_token_idx').on(t.userToken),
  ],
)
