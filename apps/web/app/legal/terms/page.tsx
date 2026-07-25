import { LegalPage, Section } from '@/components/legal'

export const metadata = { title: 'Terms of Service' }

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="26 July 2026">
      <p>
        These terms govern your use of <strong>[SITE NAME]</strong>, operated by{' '}
        <strong>[COMPANY NAME]</strong>. By creating an account you agree to them.
      </p>

      <Section title="What this service is">
        <p>
          We are an aggregator. We do not write the surveys and offers ourselves — third-party
          providers supply them, pay us for completed actions, and we pass a share to you as
          points. Whether you qualify for a given survey, and whether an action counts as
          completed, is decided by that provider, not by us.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          One account per person. Creating multiple accounts, sharing an account, or using
          automation, emulators or proxies to complete offers will result in suspension and
          forfeiture of any unpaid balance.
        </p>
        <p>
          You must be at least <strong>[MINIMUM AGE]</strong> years old and provide accurate
          information. You are responsible for keeping your password secure.
        </p>
      </Section>

      <Section title="Points">
        <p>
          Points have no cash value until they are redeemed, are not property, and cannot be
          transferred between accounts. We may change the rate at which points convert to currency;
          changes apply going forward and do not re-price points you have already earned.
        </p>
        <p>
          <strong>Points may be reversed.</strong> Providers can withdraw credit for a completion
          after the fact — commonly when an order is cancelled or returned, a trial is cancelled,
          or the provider determines the action was invalid. When that happens we deduct the
          corresponding points, including after they were credited to you. This is normal in this
          industry and is not a penalty.
        </p>
        <p>
          Newly earned points are held for a short period before becoming available to withdraw,
          because that is the window in which a provider can still reverse them.
        </p>
      </Section>

      <Section title="Cashing out">
        <p>
          You can request a payout once your available balance reaches the published minimum and
          your email address is confirmed. Points are deducted when you request, not when payment
          settles. If a payout is cancelled or fails, the points are returned to your balance in
          full.
        </p>
        <p>
          Payouts may be held for manual review. We do this for first payouts, unusually large
          ones, and anything our fraud checks flag. Review is intended to take{' '}
          <strong>[REVIEW WINDOW]</strong>.
        </p>
        <p>
          You are responsible for the accuracy of your payout details. We cannot recover money sent
          to a UPI ID or address you entered incorrectly.
        </p>
      </Section>

      <Section title="Referrals">
        <p>
          You earn a bonus when someone who signs up with your link first earns, plus an ongoing
          share of what they earn. That share is paid by us and is never deducted from them.
          Referring accounts you control, or promoting your link through spam or misleading claims,
          voids referral earnings.
        </p>
      </Section>

      <Section title="Fraud and suspension">
        <p>
          We may suspend an account, withhold a payout, or reverse points where we reasonably
          believe there has been fraud or a breach of these terms. Where an account is flagged
          rather than confirmed fraudulent, we hold the affected credits pending review rather than
          removing them.
        </p>
        <p>
          If you believe a decision was wrong, contact support and we will look at the underlying
          records.
        </p>
      </Section>

      <Section title="Availability and changes">
        <p>
          We provide the service as-is. Offer inventory depends on third parties and will change
          without notice. We may modify or discontinue features, and may update these terms; we
          will publish the date of any change above.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent permitted by law, our total liability to you is limited to the value of the
          unpaid balance in your account at the time the claim arises.
        </p>
      </Section>

      <Section title="Governing law and contact">
        <p>
          These terms are governed by the laws of <strong>[JURISDICTION]</strong>. Contact:{' '}
          <strong>[SUPPORT EMAIL]</strong>, <strong>[COMPANY NAME]</strong>,{' '}
          <strong>[REGISTERED ADDRESS]</strong>.
        </p>
      </Section>
    </LegalPage>
  )
}
