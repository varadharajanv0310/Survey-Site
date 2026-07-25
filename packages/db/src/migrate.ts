import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL ?? 'postgres://rewards:rewards@localhost:5433/rewards'

// fileURLToPath rather than URL.pathname: on Windows the latter yields
// '/D:/Survey%20SIte/...', with the drive letter and percent-encoded spaces
// intact, which no fs call will accept.
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const client = postgres(url, { max: 1 })
const db = drizzle(client)

console.log('migrating', url.replace(/:\/\/[^@]+@/, '://***@'))
console.log('from', migrationsFolder)

await migrate(db, { migrationsFolder })

console.log('migrations complete')
await client.end()
