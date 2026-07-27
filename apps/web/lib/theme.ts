export type ThemeName = 'tally' | 'tempo'

export const THEMES: { name: ThemeName; label: string; thesis: string }[] = [
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

const STORAGE_KEY = 'rewards.theme'

export function readTheme(): ThemeName {
  if (typeof window === 'undefined') return 'tally'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'tempo' ? 'tempo' : 'tally'
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  window.localStorage.setItem(STORAGE_KEY, theme)
}

/**
 * Runs before paint so the first frame is already in the right world.
 * Without it every load flashes Tally before switching, which is worse than
 * either theme.
 */
export const THEME_BOOT_SCRIPT = `
try {
  var t = localStorage.getItem('${STORAGE_KEY}');
  document.documentElement.dataset.theme = t === 'tempo' ? 'tempo' : 'tally';
} catch (e) {
  document.documentElement.dataset.theme = 'tally';
}
`.trim()
