export type ThemeName = 'tally' | 'tempo' | 'arrivals'

export const THEMES: { name: ThemeName; label: string; thesis: string }[] = [
  {
    name: 'arrivals',
    label: 'Arrivals',
    thesis: 'A board of what lands, and when.',
  },
  {
    name: 'tally',
    label: 'Tally',
    thesis: 'Money in an account. Quiet, private, adult.',
  },
  {
    name: 'tempo',
    label: 'Tempo',
    thesis: 'A weekly rhythm. Pace, streak, level.',
  },
]

const THEME_NAMES = new Set<string>(THEMES.map((t) => t.name))

const STORAGE_KEY = 'rewards.theme'

const normalise = (value: string | null | undefined): ThemeName | null =>
  value && THEME_NAMES.has(value) ? (value as ThemeName) : null

/**
 * `?theme=tempo` pins a tab to one direction and never writes to storage.
 *
 * localStorage is shared across tabs on one origin, so without this you cannot
 * hold Tally in one window and Tempo in another — which is exactly what
 * comparing two candidate designs requires.
 */
export function pinnedTheme(): ThemeName | null {
  if (typeof window === 'undefined') return null
  return normalise(new URLSearchParams(window.location.search).get('theme'))
}

export function readTheme(): ThemeName {
  if (typeof window === 'undefined') return 'arrivals'
  return pinnedTheme() ?? normalise(window.localStorage.getItem(STORAGE_KEY)) ?? 'arrivals'
}

/**
 * Writes the DOM attribute and storage together.
 *
 * These must never drift: the attribute drives every colour token while the
 * page component picks its layout from the same value. When they disagreed you
 * got Tempo's pace ring painted in Tally's amber.
 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  // A pinned tab is a deliberate override and must not leak to other tabs.
  if (!pinnedTheme()) window.localStorage.setItem(STORAGE_KEY, theme)
}

/**
 * Keeps a tab consistent when another tab changes the theme.
 *
 * Updates the DOM attribute only — components observe that attribute, so this
 * is the single place the change enters the page. A pinned tab ignores the
 * event entirely.
 */
export function syncThemeAcrossTabs(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || pinnedTheme()) return
    const next = normalise(event.newValue)
    if (next) document.documentElement.dataset.theme = next
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

/** Reads the attribute components should trust, rather than storage. */
export function currentTheme(): ThemeName {
  if (typeof document === 'undefined') return 'arrivals'
  return normalise(document.documentElement.dataset.theme) ?? 'arrivals'
}

/**
 * Runs before paint so the first frame is already in the right world.
 * Without it every load flashes Tally before switching, which is worse than
 * either theme.
 */
export const THEME_BOOT_SCRIPT = `
try {
  var ok = ${JSON.stringify([...THEME_NAMES])};
  var q = new URLSearchParams(location.search).get('theme');
  var t = ok.indexOf(q) > -1 ? q : localStorage.getItem('${STORAGE_KEY}');
  document.documentElement.dataset.theme = ok.indexOf(t) > -1 ? t : 'arrivals';
} catch (e) {
  document.documentElement.dataset.theme = 'arrivals';
}
`.trim()
