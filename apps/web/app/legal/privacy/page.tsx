import { LegalPage, Section } from '@/components/legal'

export const metadata = { title: 'Privacy Policy' }

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="26 July 2026">
      <p>
        This policy explains what <strong>[COMPANY NAME]</strong> (&ldquo;we&rdquo;) collects when
        you use <strong>[SITE NAME]</strong>, why we collect it, and who else sees it. It is
        written to describe what the platform actually does rather than to cover every
        theoretical possibility.
      </p>

      <Section title="What we collect">
        <p>
          <strong>Account information.</strong> Your email address and a hashed form of your
          password. We never store your password itself.
        </p>
        <p>
          <strong>Activity.</strong> The offers and surveys you open, what you complete, the points
          you earn, and every change to your balance. Because our points ledger is append-only,
          this history is retained rather than overwritten.
        </p>
        <p>
          <strong>Technical and anti-fraud signals.</strong> Your IP address, browser user agent, a
          device fingerprint derived from your browser&apos;s characteristics, and the times you
          sign in. We use these to detect people running many accounts, which is the main way this
          kind of platform is defrauded.
        </p>
        <p>
          <strong>Payout details.</strong> The UPI ID, email address or equivalent you ask us to
          pay. We store a masked version for display and a one-way hash used to detect the same
          destination being used across multiple accounts.
        </p>
      </Section>

      <Section title="Who else receives your data">
        <p>
          <strong>Survey and offer providers.</strong> When you open a survey wall or an offer, we
          pass a signed identifier that lets the provider tell us you completed it. It is not your
          email address. These providers operate their own privacy policies and may collect survey
          responses and profiling information directly from you.
        </p>
        <p>
          <strong>Payment providers.</strong> To pay you, we pass your payout destination and the
          amount to the provider handling the transfer.
        </p>
        <p>
          <strong>Fraud detection services.</strong> We may check your IP address against
          third-party services that identify proxies, VPNs and data centre traffic.
        </p>
        <p>
          <strong>We do not sell your personal information.</strong>
        </p>
      </Section>

      <Section title="Why we are allowed to process it">
        <p>
          To perform our contract with you (running your account and paying you), to meet legal
          obligations (tax and financial record keeping), and for our legitimate interest in
          preventing fraud. Where consent is the basis — non-essential cookies, marketing email —
          you can withdraw it at any time.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Financial records, including your full points ledger and payout history, are kept for{' '}
          <strong>[RETENTION PERIOD, e.g. 7 years]</strong> to meet accounting and tax
          requirements. Raw request logs from providers are kept for a shorter period and then
          removed.
        </p>
        <p>
          If you delete your account we remove or anonymise your personal details, but we retain
          the financial record of transactions already made. We cannot delete a payment that
          happened.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Depending on where you live — including under India&apos;s Digital Personal Data
          Protection Act and the GDPR — you may request a copy of your data, ask us to correct it,
          ask us to delete it, or object to certain processing. Write to{' '}
          <strong>[PRIVACY EMAIL]</strong> and we will respond within{' '}
          <strong>[RESPONSE WINDOW]</strong>.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Passwords are hashed. Session tokens are stored only as hashes, so a database breach does
          not hand over live sessions. Payout destinations are stored masked and hashed. This
          reduces risk; it does not eliminate it, and no service can promise that it does.
        </p>
      </Section>

      <Section title="Children">
        <p>
          This service is for people aged <strong>[MINIMUM AGE, e.g. 18]</strong> and over. We do
          not knowingly collect information from anyone younger, and will delete such an account if
          we learn of it.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          <strong>[COMPANY NAME]</strong>, <strong>[REGISTERED ADDRESS]</strong>. Questions about
          this policy: <strong>[PRIVACY EMAIL]</strong>.
        </p>
      </Section>
    </LegalPage>
  )
}
