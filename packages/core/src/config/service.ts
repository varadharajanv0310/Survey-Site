import { sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { settings as settingsTable, settingsVersions } from '@app/db/schema'
import { DEFAULT_SETTINGS, SETTING_DESCRIPTIONS, type SettingsShape } from './settings'

/**
 * Settings live in the database so a business number can change without a
 * deploy, and every change is versioned so history stays interpretable.
 *
 * The version matters more than it looks. Ledger entries and completions store
 * the `configVersion` they were priced under; without it, changing the
 * points-per-dollar rate silently re-prices every past transaction the next
 * time anything recomputes, and reconciling a network's invoice against our
 * own numbers becomes guesswork.
 *
 * Cached in memory with a short TTL: this is read on every postback and every
 * page load, and it changes a few times a year.
 */
export class SettingsService {
  private cache: { values: SettingsShape; version: number; loadedAt: number } | null = null

  constructor(
    private readonly db: Database,
    private readonly ttlMs = 30_000,
  ) {}

  async get(): Promise<{ values: SettingsShape; version: number }> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.ttlMs) {
      return { values: this.cache.values, version: this.cache.version }
    }

    const rows = await this.db.select().from(settingsTable)
    const values = { ...DEFAULT_SETTINGS } as Record<string, unknown>

    for (const row of rows) {
      if (row.key in values) values[row.key] = row.value
    }

    const [versionRow] = (await this.db.execute(
      sql`SELECT COALESCE(MAX(version), 0)::TEXT AS v FROM settings_versions`,
    )) as unknown as { v: string }[]

    const version = Number(versionRow?.v ?? 0)
    this.cache = { values: values as SettingsShape, version, loadedAt: Date.now() }
    return { values: values as SettingsShape, version }
  }

  async set<K extends keyof SettingsShape>(
    key: K,
    value: SettingsShape[K],
    adminId: string | null,
    reason?: string,
  ): Promise<number> {
    const current = await this.get()

    const version = await this.db.transaction(async (tx) => {
      await tx
        .insert(settingsTable)
        .values({
          key: key as string,
          value: value as unknown as Record<string, unknown>,
          valueType: typeof value,
          description: SETTING_DESCRIPTIONS[key],
          updatedByAdminId: adminId,
        })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: value as never, updatedAt: sql`now()`, updatedByAdminId: adminId },
        })

      const [inserted] = await tx
        .insert(settingsVersions)
        .values({
          key: key as string,
          previousValue: current.values[key] as unknown as Record<string, unknown>,
          value: value as unknown as Record<string, unknown>,
          changedByAdminId: adminId,
          reason: reason ?? null,
        })
        .returning({ version: settingsVersions.version })

      return inserted!.version
    })

    this.cache = null
    return version
  }

  /** Writes the defaults on first boot so the admin UI has rows to edit. */
  async seedDefaults(): Promise<void> {
    const entries = Object.entries(DEFAULT_SETTINGS)
    await this.db
      .insert(settingsTable)
      .values(
        entries.map(([key, value]) => ({
          key,
          value: value as unknown as Record<string, unknown>,
          valueType: typeof value,
          description: SETTING_DESCRIPTIONS[key as keyof SettingsShape],
        })),
      )
      .onConflictDoNothing()
    this.cache = null
  }

  invalidate(): void {
    this.cache = null
  }
}
