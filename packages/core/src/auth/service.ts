import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Database } from '@app/db'
import { authEvents, authTokens, referrals, sessions, users } from '@app/db/schema'
import { fakeVerify, hashPassword, verifyPassword } from './password'
import { generateReferralCode, generateToken, hashToken } from './tokens'

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'email_taken'
      | 'invalid_credentials'
      | 'account_suspended'
      | 'account_banned'
      | 'invalid_token'
      | 'weak_password',
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export type RequestContext = {
  ip?: string | undefined
  userAgent?: string | undefined
  deviceFingerprint?: string | undefined
}

export type SessionResult = {
  userId: string
  /** Given to the client once. Only its hash is stored. */
  token: string
  expiresAt: Date
}

const SESSION_TTL_DAYS = 30
const RESET_TTL_MINUTES = 60
const VERIFY_TTL_HOURS = 48

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly deps: {
      /** Console-logged today; a real sender drops in behind the same call. */
      sendEmail: (to: string, subject: string, body: string) => Promise<void>
    },
  ) {}

  async signup(input: {
    email: string
    password: string
    referralCode?: string | undefined
    country?: string | undefined
    ctx?: RequestContext
  }): Promise<{ userId: string; session: SessionResult }> {
    const email = normalizeEmail(input.email)
    if (input.password.length < 8) {
      throw new AuthError('password must be at least 8 characters', 'weak_password')
    }

    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (existing) throw new AuthError('that email is already registered', 'email_taken')

    const passwordHash = await hashPassword(input.password)

    // Referral is resolved before the insert so an invalid code is simply
    // ignored rather than failing the signup. A user who mistypes a friend's
    // code should still get an account.
    let referrerId: string | null = null
    const code = input.referralCode?.trim().toUpperCase()
    if (code) {
      const [referrer] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.referralCode, code))
        .limit(1)
      referrerId = referrer?.id ?? null
    }

    const userId = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          referralCode: await this.uniqueReferralCode(),
          referredByUserId: referrerId,
          country: input.country ?? null,
          signupIp: input.ctx?.ip ?? null,
          signupUserAgent: input.ctx?.userAgent ?? null,
        })
        .returning({ id: users.id })

      const newUserId = created!.id

      if (referrerId && referrerId !== newUserId) {
        // Unique on referee_user_id: attribution is permanent and one-way.
        // The bonus is NOT paid here — see qualifyReferral. Paying at signup
        // is free money for anyone with a disposable email address.
        await tx
          .insert(referrals)
          .values({ referrerUserId: referrerId, refereeUserId: newUserId, codeUsed: code! })
          .onConflictDoNothing()
      }

      await tx.insert(authEvents).values({
        userId: newUserId,
        kind: 'signup',
        ip: input.ctx?.ip ?? null,
        userAgent: input.ctx?.userAgent ?? null,
        deviceFingerprint: input.ctx?.deviceFingerprint ?? null,
      })

      return newUserId
    })

    await this.sendVerificationEmail(userId, email)
    const session = await this.createSession(userId, input.ctx)
    return { userId, session }
  }

  async login(input: {
    email: string
    password: string
    ctx?: RequestContext
  }): Promise<{ userId: string; session: SessionResult }> {
    const email = normalizeEmail(input.email)

    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (!user) {
      // Spend the same time as a real verification, so response latency does
      // not reveal whether the account exists.
      await fakeVerify()
      await this.db.insert(authEvents).values({
        attemptedEmail: email,
        kind: 'login_failed',
        ip: input.ctx?.ip ?? null,
        userAgent: input.ctx?.userAgent ?? null,
      })
      throw new AuthError('email or password is incorrect', 'invalid_credentials')
    }

    const ok = await verifyPassword(input.password, user.passwordHash)
    if (!ok) {
      await this.db.insert(authEvents).values({
        userId: user.id,
        attemptedEmail: email,
        kind: 'login_failed',
        ip: input.ctx?.ip ?? null,
        userAgent: input.ctx?.userAgent ?? null,
      })
      throw new AuthError('email or password is incorrect', 'invalid_credentials')
    }

    if (user.status === 'banned') throw new AuthError('this account is banned', 'account_banned')
    if (user.status === 'suspended') {
      throw new AuthError('this account is suspended', 'account_suspended')
    }

    await this.db.insert(authEvents).values({
      userId: user.id,
      kind: 'login',
      ip: input.ctx?.ip ?? null,
      userAgent: input.ctx?.userAgent ?? null,
      deviceFingerprint: input.ctx?.deviceFingerprint ?? null,
    })

    return { userId: user.id, session: await this.createSession(user.id, input.ctx) }
  }

  async createSession(userId: string, ctx?: RequestContext): Promise<SessionResult> {
    const token = generateToken()
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000)

    await this.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    })

    return { userId, token, expiresAt }
  }

  /**
   * Returns null rather than throwing: an expired session is an ordinary
   * event on every request, not an exception.
   *
   * Status is re-read on every validation, so banning a user takes effect on
   * their next request rather than whenever their token happens to expire.
   * That property is the reason these are opaque server-side sessions instead
   * of JWTs.
   */
  async validateSession(
    token: string,
  ): Promise<{ userId: string; status: 'active' | 'suspended' | 'banned' } | null> {
    const [row] = await this.db
      .select({ userId: sessions.userId, status: users.status })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1)

    if (!row) return null
    if (row.status === 'banned') return null
    return { userId: row.userId, status: row.status }
  }

  async logout(token: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(sessions.tokenHash, hashToken(token)))
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
  }

  /**
   * Always resolves, whether or not the address exists. Telling an
   * unauthenticated caller which addresses are registered is an enumeration
   * oracle, and password reset is the easiest place to hit it at scale.
   */
  async requestPasswordReset(email: string, ctx?: RequestContext): Promise<void> {
    const normalized = normalizeEmail(email)
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1)

    if (!user) return

    const token = generateToken()
    await this.db.insert(authTokens).values({
      userId: user.id,
      purpose: 'password_reset',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
    })

    await this.db.insert(authEvents).values({
      userId: user.id,
      kind: 'password_reset_requested',
      ip: ctx?.ip ?? null,
    })

    await this.deps.sendEmail(
      normalized,
      'Reset your password',
      `Reset link: ${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/reset?token=${token}\n` +
        `This link expires in ${RESET_TTL_MINUTES} minutes.`,
    )
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new AuthError('password must be at least 8 characters', 'weak_password')
    }

    const [row] = await this.db
      .select({ id: authTokens.id, userId: authTokens.userId })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, hashToken(token)),
          eq(authTokens.purpose, 'password_reset'),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, sql`now()`),
        ),
      )
      .limit(1)

    if (!row) throw new AuthError('that reset link is invalid or has expired', 'invalid_token')

    const passwordHash = await hashPassword(newPassword)

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId))
      await tx.update(authTokens).set({ usedAt: sql`now()` }).where(eq(authTokens.id, row.id))
      await tx.insert(authEvents).values({ userId: row.userId, kind: 'password_reset_completed' })
    })

    // Whoever changed the password keeps their access; everyone else loses it.
    // If the reset was triggered by an account takeover, this is what evicts
    // the attacker.
    await this.revokeAllSessions(row.userId)
  }

  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = generateToken()
    await this.db.insert(authTokens).values({
      userId,
      purpose: 'email_verification',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 3600_000),
    })

    await this.deps.sendEmail(
      email,
      'Confirm your email',
      `Confirm: ${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/verify?token=${token}`,
    )
  }

  async verifyEmail(token: string): Promise<string> {
    const [row] = await this.db
      .select({ id: authTokens.id, userId: authTokens.userId })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, hashToken(token)),
          eq(authTokens.purpose, 'email_verification'),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, sql`now()`),
        ),
      )
      .limit(1)

    if (!row) throw new AuthError('that link is invalid or has expired', 'invalid_token')

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerifiedAt: sql`now()` }).where(eq(users.id, row.userId))
      await tx.update(authTokens).set({ usedAt: sql`now()` }).where(eq(authTokens.id, row.id))
      await tx.insert(authEvents).values({ userId: row.userId, kind: 'email_verified' })
    })

    return row.userId
  }

  private async uniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateReferralCode()
      const [clash] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.referralCode, code))
        .limit(1)
      if (!clash) return code
    }
    // 32^8 is ~1.1e12; eight straight collisions means something is wrong.
    throw new Error('could not generate a unique referral code')
  }
}
