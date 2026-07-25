import Link from 'next/link'

/**
 * Shared chrome for the legal pages.
 *
 * These are drafts written to be accurate about what the system actually does
 * — which is the part a template cannot do — not a substitute for review by
 * someone qualified. The banner says so, and stays until you have had them
 * looked at.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="text-sm font-medium text-[var(--color-brand)]">
        ← Back
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">Last updated {updated}</p>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong className="font-semibold">Draft — not yet reviewed by a lawyer.</strong> The
        factual descriptions of how the platform handles data and payments are accurate. The legal
        framing is not a substitute for advice, and the placeholders in square brackets must be
        filled in before launch.
      </div>

      <article className="legal mt-8 space-y-6 text-sm leading-relaxed text-slate-700">
        {children}
      </article>

      <div className="mt-12 flex gap-4 border-t border-[var(--color-line)] pt-6 text-sm">
        <Link href="/legal/privacy" className="text-[var(--color-brand)]">
          Privacy Policy
        </Link>
        <Link href="/legal/terms" className="text-[var(--color-brand)]">
          Terms of Service
        </Link>
      </div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  )
}
