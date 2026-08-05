import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, Instrument_Sans, Outfit } from 'next/font/google'
import { ThemeBoot } from '@/components/theme-boot'
import { THEME_BOOT_SCRIPT } from '@/lib/theme'
import './globals.css'

// Tally's pair: a quiet grotesque for language, Plex Mono for every figure.
const instrument = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-instrument-sans',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

// Tempo runs on one family throughout.
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Rewards',
  description: 'Complete surveys and offers, earn points, cash out to UPI.',
}

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  // The audience is on phones with notches and gesture bars; content has to
  // reach the edges and pad itself back with env() insets.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /**
     * `data-theme` is deliberately absent here.
     *
     * Setting it in JSX means React reconciles it back to the server-rendered
     * literal during hydration, overwriting whatever the boot script chose —
     * so every direction except the hardcoded one silently reverted. The boot
     * script below owns the attribute outright, and `:root` in globals.css
     * carries Tally's tokens as the pre-script default.
     */
    <html
      lang="en"
      className={`${instrument.variable} ${plexMono.variable} ${outfit.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {/* Re-applies data-theme after hydration strips it. See ThemeBoot. */}
        <ThemeBoot />
        {children}
      </body>
    </html>
  )
}
