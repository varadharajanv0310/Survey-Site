'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { post } from '@/lib/api'

const NAV = [
  { href: '/admin/review', label: 'Review queue' },
  { href: '/admin/payouts', label: 'Payouts' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/reporting', label: 'Margin' },
  { href: '/admin/networks', label: 'Networks' },
  { href: '/admin/settings', label: 'Settings' },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-800 bg-[var(--color-ink)]">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3">
          <Link href="/admin/review" className="text-sm font-semibold tracking-tight text-white">
            Admin
          </Link>

          <nav className="flex flex-1 gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  pathname === item.href
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <button
            onClick={async () => {
              await post('/admin/logout')
              router.replace('/admin')
            }}
            className="text-xs text-slate-400 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  )
}
