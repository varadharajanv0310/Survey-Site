'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { THEMES, applyTheme, currentTheme, type ThemeName } from '@/lib/theme'

/**
 * Shared chrome for signed-out screens.
 *
 * The direction switcher lives here too. Someone evaluating the two designs
 * should not have to sign in first to see the other one, and the sign-in
 * screen is where the visual world makes its first claim.
 */
export function AuthLayout({
  title,
  lede,
  children,
  footer,
}: {
  title: string
  lede?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const [theme, setTheme] = useState<ThemeName>('tally')

  useEffect(() => {
    setTheme(currentTheme())
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const switchTheme = (next: ThemeName) => {
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-5 lg:px-10">
        <span className="figure text-[13px] font-semibold tracking-[0.24em] text-[var(--accent)] uppercase">
          {theme === 'tempo' ? 'Tempo' : 'Tally'}
        </span>

        <div
          role="radiogroup"
          aria-label="Visual direction"
          className="flex gap-1 rounded-[var(--radius-control)] border border-[var(--hairline)] p-1"
        >
          {THEMES.map((t) => (
            <button
              key={t.name}
              role="radio"
              aria-checked={theme === t.name}
              onClick={() => switchTheme(t.name)}
              className={`rounded-[calc(var(--radius-control)-4px)] px-3 py-1 text-[12.5px] transition-colors ${
                theme === t.name
                  ? 'bg-[var(--accent)] font-semibold text-[var(--accent-ink)]'
                  : 'text-[var(--ink-3)] hover:text-[var(--ink)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-8">
        <div className="w-full max-w-[380px]">
          <h1 className="display text-[clamp(1.75rem,7vw,2.25rem)] font-semibold">{title}</h1>
          {lede && (
            <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--ink-3)]">{lede}</p>
          )}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6">{footer}</div>}
        </div>
      </main>

      <footer className="flex items-center justify-center gap-5 px-5 py-6 text-[12.5px] text-[var(--ink-4)]">
        <Link href="/legal/privacy" className="hover:text-[var(--ink-2)]">
          Privacy
        </Link>
        <Link href="/legal/terms" className="hover:text-[var(--ink-2)]">
          Terms
        </Link>
      </footer>
    </div>
  )
}
