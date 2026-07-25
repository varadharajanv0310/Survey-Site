'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { post } from '@/lib/api'
import { Button, Field, Input } from '@/components/shell'

/** Step one: ask for a link. Reached from the sign-in page. */
function RequestReset() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    await post('/auth/password-reset/request', { email }).catch(() => {})
    setBusy(false)
    setSent(true)
  }

  // Always the same confirmation, whether or not the address exists. Telling
  // an anonymous visitor which emails are registered is an enumeration oracle,
  // and this is the easiest endpoint to hit at scale.
  if (sent) {
    return (
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          If an account exists for <strong className="text-[var(--color-ink)]">{email}</strong>,
          we&apos;ve sent a reset link. It expires in an hour.
        </p>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          <Link href="/login" className="font-medium text-[var(--color-brand)]">
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        We&apos;ll email you a link to set a new one.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>

      <p className="mt-5 text-sm text-[var(--color-muted)]">
        <Link href="/login" className="font-medium text-[var(--color-brand)]">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}

/** Step two: the link itself, carrying a token. */
function ApplyReset({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password !== confirm) {
      setError('those passwords do not match')
      return
    }
    setBusy(true)
    setError('')
    try {
      await post('/auth/password-reset/confirm', { token, password })
      router.push('/login?reset=1')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not reset password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="New password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            required
          />
        </Field>

        {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Saving…' : 'Set new password'}
        </Button>

        <p className="text-xs leading-relaxed text-[var(--color-muted)]">
          Setting a new password signs you out everywhere else. If someone else had access to your
          account, this is what removes it.
        </p>
      </form>
    </div>
  )
}

function ResetPage() {
  const token = useSearchParams().get('token')
  return token ? <ApplyReset token={token} /> : <RequestReset />
}

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Suspense>
        <ResetPage />
      </Suspense>
    </div>
  )
}
