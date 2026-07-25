'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { post } from '@/lib/api'
import { Button, Field, Input } from '@/components/shell'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('demo@example.com')
  const [password, setPassword] = useState('password123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await post('/auth/login', { email, password })
      router.push('/earn')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Seeded accounts use the password <code className="font-mono">password123</code>.
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
              required
            />
          </Field>

          {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-5 text-sm text-[var(--color-muted)]">
          No account?{' '}
          <Link href="/signup" className="font-medium text-[var(--color-brand)]">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
