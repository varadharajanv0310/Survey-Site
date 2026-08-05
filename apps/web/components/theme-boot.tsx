'use client'

import { useLayoutEffect } from 'react'
import { readTheme, syncThemeAcrossTabs } from '@/lib/theme'

/**
 * Owns `data-theme` on <html> after hydration.
 *
 * This exists because React wins any argument about that attribute:
 *
 *  - Put `data-theme` in the layout's JSX and React reconciles it back to the
 *    server-rendered literal, so every direction except the hardcoded one
 *    silently reverted.
 *  - Leave it out and React *strips* whatever the pre-paint inline script set,
 *    which is how `?theme=tempo` ended up rendering Tally.
 *
 * `suppressHydrationWarning` silences the warning but does not stop the
 * reconciliation. So the inline script still runs first — it is what makes the
 * very first paint correct — and this re-applies the same value in a layout
 * effect, which fires before the browser paints again. Net result: no flash and
 * no fight.
 *
 * The value comes from `readTheme()`, which prefers a `?theme=` pin over
 * storage, so the two agree by construction rather than by luck.
 */
export function ThemeBoot() {
  useLayoutEffect(() => {
    // Unconditionally, not "only if different". `currentTheme()` falls back to
    // 'tally' when the attribute is missing, so a guard here reads a missing
    // attribute as already-correct and leaves it unset — right on screen by
    // coincidence, and wrong for anything that later reads the attribute.
    document.documentElement.dataset.theme = readTheme()
    return syncThemeAcrossTabs()
  }, [])

  return null
}
