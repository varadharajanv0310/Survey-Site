import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { adminSessions, adminUsers, auditLog } from '@app/db/schema'
import { fakeVerify, hashPassword, verifyPassword } from './password'
import { generateToken, hashToken } from './tokens'

export type AdminRole = 'viewer' | 'reviewer' | 'superadmin'

/** Admin sessions expire faster than user sessions: they can approve payouts. */
const ADMIN_SESSION_TTL_HOURS = 12

/**
 * Admin authentication, kept separate from user authentication all the way
 * down: different table, different session table, different cookie, different
 * validation path.
 *
 * A bug that confuses a user session for an admin session should not be
 * expressible, which is worth the small amount of duplication.
 */
export class AdminAuthService {
  constructor(private readonly db: Database) {}

  async login(
    email: string,
    password: string,
    ip?: string,
  ): Promise<{ token: string; role: AdminRole } | null> {
    const [admin] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email.trim().toLowerCase()))
      .limit(1)

    if (!admin) {
      await fakeVerify()
      return null
    }
    if (!admin.isActive) return null
    if (!(await verifyPassword(password, admin.passwordHash))) return null

    const token = generateToken()
    await this.db.insert(adminSessions).values({
      adminId: admin.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_HOURS * 3600_000),
      ip: ip ?? null,
    })

    return { token, role: admin.role as AdminRole }
  }

  async validate(token: string): Promise<{ id: string; role: AdminRole } | null> {
    const [row] = await this.db
      .select({ id: adminUsers.id, role: adminUsers.role, isActive: adminUsers.isActive })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
      .where(
        and(
          eq(adminSessions.tokenHash, hashToken(token)),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1)

    if (!row || !row.isActive) return null
    return { id: row.id, role: row.role as AdminRole }
  }

  async logout(token: string): Promise<void> {
    await this.db
      .update(adminSessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(adminSessions.tokenHash, hashToken(token)))
  }

  async create(email: string, password: string, role: AdminRole): Promise<string> {
    const [admin] = await this.db
      .insert(adminUsers)
      .values({
        email: email.trim().toLowerCase(),
        passwordHash: await hashPassword(password),
        role,
      })
      .returning({ id: adminUsers.id })
    return admin!.id
  }

  /**
   * Every mutating admin action goes through here.
   *
   * In a system where one person can zero a user's balance or approve a
   * payout, "who did this and why" needs to be answerable months later without
   * relying on anyone's memory.
   */
  async audit(input: {
    adminId: string
    action: string
    subjectType: string
    subjectId?: string
    before?: unknown
    after?: unknown
    reason?: string
    ip?: string
  }): Promise<void> {
    await this.db.insert(auditLog).values({
      adminId: input.adminId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      before: (input.before ?? null) as Record<string, unknown> | null,
      after: (input.after ?? null) as Record<string, unknown> | null,
      reason: input.reason ?? null,
      ip: input.ip ?? null,
    })
  }
}
