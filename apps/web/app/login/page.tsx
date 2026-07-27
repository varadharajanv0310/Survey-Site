'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { post } from '@/lib/api'
import { getFingerprint } from '@/lib/fingerprint'
import { AuthLayout } from '@/components/auth-layout'
import { Button, Field, Input, Note } from '@/components/ui'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('demo@example.com')
  const [password, setPassword] = useState('password123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await post('/auth/login', {
        email,
        password,
        deviceFingerprint: await getFingerprint(),
      })
      router.push('/wallet')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {params.get('reset') === '1' && (
        <Note>Password changed. Sign in with your new one.</Note>
      )}

      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>

        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        {error && <Note tone="negative">{error}</Note>}

        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>

      <div className="mt-5 space-y-2 text-[14px]">
        <p>
          <Link href="/reset" className="font-medium text-[var(--accent)]">
            Forgot your password?
          </Link>
        </p>
        <p className="text-[var(--ink-3)]">
          No account?{' '}
          <Link href="/signup" className="font-medium text-[var(--accent)]">
            Create one
          </Link>
        </p>
      </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <AuthLayout
      title="Sign in"
      lede="Seeded demo accounts use the password password123."
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  )
}
