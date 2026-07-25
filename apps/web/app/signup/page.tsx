'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { post } from '@/lib/api'
import { getFingerprint } from '@/lib/fingerprint'
import { Button, Field, Input } from '@/components/shell'

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
      setError(err instanceof Error ? err.message : 'sign up failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Confirm your email before your first cash out.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </Field>
        <Field label="Referral code (optional)">
          <Input
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            placeholder="ABCD2345"
          />
        </Field>

        {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-5 text-sm text-[var(--color-muted)]">
        Already have one?{' '}
        <Link href="/login" className="font-medium text-[var(--color-brand)]">
          Sign in
        </Link>
      </p>

      <p className="mt-8 text-xs leading-relaxed text-[var(--color-muted)]">
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
    </div>
  )
}

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Suspense>
        <SignupForm />
      </Suspense>
    </div>
  )
}
