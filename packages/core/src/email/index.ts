/**
 * Email delivery behind an interface, so nothing in the codebase knows or
 * cares which provider is sending.
 *
 * There is no email account yet. The console sender is the honest default —
 * it prints the message and says plainly that nothing was sent, rather than
 * resolving silently and letting the rest of the system believe mail is going
 * out. A user who never receives a password reset and a system that reports
 * success is the worst of both.
 */

export type EmailMessage = {
  to: string
  subject: string
  /** Plain text. Deliverability is better and this audience reads on mobile. */
  text: string
  html?: string
}

export type SendResult =
  | { delivered: true; providerId: string }
  | { delivered: false; reason: string }

export interface EmailProvider {
  readonly key: string
  send(message: EmailMessage): Promise<SendResult>
}

/** Default. Prints to stdout and is explicit that nothing left the building. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly key = 'console'

  async send(message: EmailMessage): Promise<SendResult> {
    console.log(
      [
        '',
        '--- EMAIL (not sent: no provider configured) ---',
        `to:      ${message.to}`,
        `subject: ${message.subject}`,
        '',
        message.text,
        '--- end email ---',
        '',
      ].join('\n'),
    )
    return { delivered: false, reason: 'no email provider configured' }
  }
}

/**
 * Resend. Chosen for the same reason as everything else here: one HTTP call,
 * no SDK, nothing to keep up to date.
 *
 * Uses global fetch rather than a client library so this file has no
 * dependencies and can be swapped for Postmark or SES by editing one function.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly key = 'resend'

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
        // A password reset must not hold a request open indefinitely because
        // an email API is slow.
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) {
        const body = await response.text()
        return { delivered: false, reason: `resend ${response.status}: ${body.slice(0, 200)}` }
      }

      const body = (await response.json()) as { id?: string }
      return { delivered: true, providerId: body.id ?? 'unknown' }
    } catch (error) {
      // Never throw. A failed send is reported to the caller, which decides
      // whether it is fatal — for a verification email it is not.
      return {
        delivered: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export function createEmailProvider(env = process.env): EmailProvider {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) return new ConsoleEmailProvider()

  const from = env.EMAIL_FROM
  if (!from) {
    // Misconfiguration, not absence. Loud rather than silently falling back,
    // because "we set the key and mail still is not arriving" is a bad hour.
    throw new Error('RESEND_API_KEY is set but EMAIL_FROM is not')
  }
  return new ResendEmailProvider(apiKey, from)
}
