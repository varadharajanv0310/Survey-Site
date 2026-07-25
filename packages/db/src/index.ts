import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index'

export * as schema from './schema/index'
export * from './schema/index'

export type Database = ReturnType<typeof createDb>

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set')

  const client = postgres(url, {
    max: Number(process.env.PG_POOL_MAX ?? 10),
    // Ledger work uses explicit transactions and (soon) row locks; prepared
    // statements interact badly with connection poolers in front of Postgres.
    prepare: false,
  })

  return drizzle(client, { schema })
}
