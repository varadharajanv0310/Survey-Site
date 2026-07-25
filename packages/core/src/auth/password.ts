import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

/**
 * scrypt from node's standard library rather than argon2id.
 *
 * argon2id is the first choice in the OWASP guidance and scrypt is the
 * accepted second, so this is a real trade rather than a free one. It buys us
 * zero native dependencies: argon2 bindings need either a prebuilt binary for
 * every platform we touch or a working C++ toolchain, and this project is
 * developed on Windows and will deploy on Linux.
 *
 * Parameters follow the OWASP minimum (N=2^17, r=8, p=1), which costs ~128MB
 * and ~100ms per hash. Swapping to argon2id later means changing this file and
 * rehashing on next login — the stored format is prefixed so both can coexist.
 */
const N = 2 ** 17
const r = 8
const p = 1
const KEY_LEN = 64
const PREFIX = 'scrypt'

export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error('password must not be empty')
  const salt = randomBytes(16)
  const key = (await scrypt(plain.normalize('NFKC'), salt, KEY_LEN, {
    N,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  })) as Buffer
  return [PREFIX, N, r, p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX) return false

  const [, nStr, rStr, pStr, saltB64, keyB64] = parts
  const salt = Buffer.from(saltB64!, 'base64')
  const expected = Buffer.from(keyB64!, 'base64')

  const actual = (await scrypt(plain.normalize('NFKC'), salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
    maxmem: 256 * 1024 * 1024,
  })) as Buffer

  // Constant time: a fast negative leaks how much of the hash matched.
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * Burn roughly the same time as a real verification when the account does not
 * exist. Otherwise "no such user" returns in 1ms and "wrong password" in
 * 100ms, which is a free account-enumeration oracle.
 */
export async function fakeVerify(): Promise<void> {
  await hashPassword('timing-equalisation-dummy-value')
}
