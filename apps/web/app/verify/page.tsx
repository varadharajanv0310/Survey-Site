'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { post } from '@/lib/api'
import { Button } from '@/components/shell'

type State = 'checking' | 'done' | 'failed' | 'missing'

function Verify() {
  const token = useSearchParams().get('token')
  const [state, setState] = useState<State>(token ? 'checking' : 'missing')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    post('/auth/verify-email', { token })
      .then(() => setState('done'))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'that link did not work')
        setState('failed')
      })
  }, [token])

  if (state === 'checking') {
    return <p className="text-sm text-[var(--color-muted)]">Confirming your email…</p>
  }

  if (state === 'done') {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-2xl">
          ✓
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Email confirmed</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          You can now cash out once you reach the minimum balance.
        </p>
        <Link href="/earn">
          <Button className="mt-6 w-full">Start earning</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {state === 'missing' ? 'Nothing to confirm' : 'That link has expired'}
      </h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        {state === 'missing'
          ? 'This page is reached from the link in your confirmation email.'
          : (error ?? 'Confirmation links are valid for 48 hours.')}
      </p>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Sign in and we&apos;ll send you a fresh one.
      </p>
      <Link href="/login">
        <Button variant="ghost" className="mt-6 w-full">
          Go to sign in
        </Button>
      </Link>
    </div>
  )
}

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Suspense>
        <Verify />
      </Suspense>
    </div>
  )
}
