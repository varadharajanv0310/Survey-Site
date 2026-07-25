import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Session tokens, reset tokens and verification tokens are all the same shape:
 * a long random string given to the user, and only its SHA-256 stored.
 *
 * Storing the hash means a database leak does not hand over live sessions or
 * usable password-reset links. These are high-entropy random values, not
 * passwords, so a plain fast hash is correct here — scrypt would buy nothing
 * against a 256-bit random string and would make every request slow.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64')
}

export function tokensMatch(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token))
  const b = Buffer.from(storedHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O/0, I/1

/** Referral codes get read aloud and typed by hand, so ambiguous glyphs are out. */
export function generateReferralCode(length = 8): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return out
}

/**
 * The signed identifier we hand to offer walls and survey walls, and that they
 * echo back to us on the postback.
 *
 * This must not be a bare user id. Walls reflect whatever `sub_id` we put in
 * the URL, so an unsigned identifier means anyone can credit any account by
 * calling our postback endpoint with someone else's id. The signature makes
 * the identifier unforgeable without the secret.
 *
 * Format: `<userId>.<hmac>` — readable in logs, and the wall treats it as an
 * opaque string.
 */
export function signUserToken(userId: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(userId).digest('base64url').slice(0, 27)
  return `${userId}.${mac}`
}

export function verifyUserToken(token: string, secret: string): string | null {
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null

  const userId = token.slice(0, idx)
  const provided = token.slice(idx + 1)
  const expected = createHmac('sha256', secret).update(userId).digest('base64url').slice(0, 27)

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return userId
}

/**
 * Normalised so `payout@Gmail.com ` and `payout@gmail.com` hash alike. Used to
 * spot one payout destination shared across many accounts, which is the
 * clearest multi-accounting signal in the system.
 */
export function hashDestination(destination: string, secret: string): string {
  return createHmac('sha256', secret).update(destination.trim().toLowerCase()).digest('base64')
}

export function maskDestination(destination: string): string {
  const value = destination.trim()
  const at = value.indexOf('@')
  if (at > 0) {
    const local = value.slice(0, at)
    const domain = value.slice(at)
    const head = local.slice(0, 1)
    return `${head}${'•'.repeat(Math.max(3, local.length - 1))}${domain}`
  }
  if (value.length <= 4) return '•'.repeat(value.length)
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`
}
