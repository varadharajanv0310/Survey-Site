'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { post } from '@/lib/api'
import { getFingerprint } from '@/lib/fingerprint'
import { AuthLayout } from '@/components/auth-layout'
import { Button, Field, Input, Note } from '@/components/ui'

function SignupForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState(params.get('ref') ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await post('/auth/signup', {
        email,
        password,
        referralCode: referralCode || undefined,
        deviceFingerprint: await getFingerprint(),
      })
      router.push('/earn')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>

        <Field label="Password" hint="At least 8 characters.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        <Field label="Referral code" hint="Optional. Your friend earns from our share, never yours.">
          <Input
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            placeholder="ABCD2345"
            autoCapitalize="characters"
          />
        </Field>

        {error && <Note tone="negative">{error}</Note>}

        <Button type="submit" loading={busy} className="w-full">
          Create account
        </Button>
      </form>

      {/* Said up front rather than discovered later. Both are true and both
          are things people in this category have learned to check for. */}
      <ul className="mt-6 space-y-2 text-[13.5px] text-[var(--ink-3)]">
        <li>Free to join. No deposit, and no fee taken from a payout.</li>
        <li>Cash out to UPI once you reach the minimum.</li>
        <li>Confirm your email before your first payout.</li>
      </ul>

      <p className="mt-6 text-[14px] text-[var(--ink-3)]">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-[var(--accent)]">
          Sign in
        </Link>
      </p>

      <p className="mt-4 text-[12.5px] leading-relaxed text-[var(--ink-4)]">
        By creating an account you agree to our{' '}
        <Link href="/legal/terms" className="underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    </>
  )
}

export default function SignupPage() {
  return (
    <AuthLayout title="Create an account" lede="Complete surveys and offers, cash out to UPI.">
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthLayout>
  )
}
