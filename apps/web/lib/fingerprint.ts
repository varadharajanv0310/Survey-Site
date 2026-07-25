/**
 * Browser fingerprinting, used only as one fraud signal among several.
 *
 * FingerprintJS open source, not the paid identification API. It gives a
 * stable-ish hash from browser and device characteristics. Two honest limits,
 * both of which is why this never decides anything on its own:
 *
 *  - It is defeatable. Someone determined will run separate browser profiles
 *    or a fingerprint spoofer and get distinct values per account.
 *  - It has false positives. Identical stock Android phones on the same
 *    browser version can collide, and this audience is disproportionately on
 *    exactly that kind of device.
 *
 * So a shared fingerprint contributes to a score that can send an account to
 * human review. It never bans anyone by itself. See `duplicateDevice` in
 * packages/core/src/fraud/checks.ts for the weighting.
 */

let cached: string | undefined
let inFlight: Promise<string | undefined> | undefined

export async function getFingerprint(): Promise<string | undefined> {
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      // Loaded lazily so it never blocks first paint. On a mid-range Android
      // this costs tens of milliseconds, which is worth deferring.
      const FingerprintJS = (await import('@fingerprintjs/fingerprintjs')).default
      const agent = await FingerprintJS.load()
      const result = await agent.get()
      cached = result.visitorId
      return cached
    } catch {
      // Blocked by a privacy extension, or an unsupported browser. Not an
      // error worth surfacing: signup must work regardless, and the fraud
      // pipeline treats a missing fingerprint as no signal rather than as
      // suspicious. Punishing privacy tooling would cost real users.
      return undefined
    } finally {
      inFlight = undefined
    }
  })()

  return inFlight
}
