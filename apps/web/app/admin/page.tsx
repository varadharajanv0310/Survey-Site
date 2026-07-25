'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { post } from '@/lib/api'
import { Button, Field, Input } from '@/components/shell'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('admin12345')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await post('/admin/login', { email, password })
      router.push('/admin/review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-ink)] px-5">
      <div className="w-full max-w-sm rounded-xl bg-white p-7">
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Separate credentials from user accounts.
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
      </div>
    </div>
  )
}
