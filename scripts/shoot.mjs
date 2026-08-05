/**
 * Screenshots every theme at mobile and desktop, and audits what a computed
 * style can tell you: contrast against the real background, horizontal
 * overflow, and whether the rendered layout matches the active theme.
 *
 * Exists because the in-editor browser pane cannot be relied on to composite
 * frames, which left visual verification as an assertion rather than a look.
 *
 *   node scripts/shoot.mjs [--themes arrivals,tally] [--routes /wallet,/earn]
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const WEB = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'
const API = process.env.API_PUBLIC_URL ?? 'http://localhost:4000'
const OUT = arg('out', 'docs/screenshots')
const THEMES = arg('themes', 'arrivals,tally,tempo').split(',')
const ROUTES = arg('routes', '/wallet').split(',')

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
]

/** WCAG relative luminance and contrast, run in-page against real colours. */
const AUDIT = `(() => {
  const lum = (rgb) => {
    const [r,g,b] = rgb.match(/[\\d.]+/g).slice(0,3).map(Number).map(v => {
      const s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4);
    });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  const ratio = (a,b) => { const L1=lum(a), L2=lum(b); const [hi,lo]=L1>L2?[L1,L2]:[L2,L1];
    return +((hi+0.05)/(lo+0.05)).toFixed(2); };
  const cs = getComputedStyle(document.documentElement);
  const bg = getComputedStyle(document.body).backgroundColor;
  const probe = (name) => {
    const el = document.createElement('span');
    el.style.color = cs.getPropertyValue(name).trim();
    document.body.appendChild(el);
    const c = getComputedStyle(el).color; el.remove();
    return ratio(c, bg);
  };
  return {
    theme: document.documentElement.dataset.theme,
    overflow: document.documentElement.scrollWidth > window.innerWidth
      ? document.documentElement.scrollWidth - window.innerWidth : 0,
    body: probe('--ink-3'),      // must clear 4.5:1
    heading: probe('--ink'),
    large: probe('--ink-4'),     // must clear 3:1
  };
})()`

/**
 * Signs in once and returns the cookie jar.
 *
 * Logging in per viewport tripped the API's own credential rate limit
 * (10 per 5 minutes) after a couple of runs, and every later shot came back
 * 401. The limiter was right; the script was wrong.
 */
const signIn = async (browser) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${WEB}/login`)
  const status = await page.evaluate(
    async ([api]) => {
      const r = await fetch(`${api}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'demo@example.com', password: 'password123' }),
      })
      return r.status
    },
    [API],
  )
  if (status !== 200) {
    throw new Error(
      `login failed with ${status}` +
        (status === 429 ? ' — credential rate limit; wait 5 minutes and rerun' : ''),
    )
  }
  const state = await context.storageState()
  await context.close()
  return state
}

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const problems = []
  const storageState = await signIn(browser)

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      storageState,
    })

    const page = await context.newPage()

    // A screenshot cannot show a console error, and a dev-overlay badge in the
    // corner of a design review is the least useful way to learn about one.
    const consoleErrors = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 180))
    })
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 180)}`))
    for (const theme of THEMES) {
      for (const route of ROUTES) {
        const slug = route.replace(/\W+/g, '') || 'home'
        await page.goto(`${WEB}${route}?theme=${theme}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(500)

        const audit = await page.evaluate(AUDIT)
        const file = `${OUT}/${theme}-${slug}-${viewport.name}.png`
        await page.screenshot({ path: file, fullPage: viewport.name === 'desktop' })

        const flags = []
        if (audit.theme !== theme) flags.push(`theme=${audit.theme} expected ${theme}`)
        if (audit.overflow > 0) flags.push(`overflow ${audit.overflow}px`)
        if (audit.body < 4.5) flags.push(`body contrast ${audit.body}`)
        if (audit.large < 3) flags.push(`large contrast ${audit.large}`)
        if (consoleErrors.length) flags.push(`console: ${consoleErrors[0]}`)
        if (flags.length) problems.push(`${theme} ${route} ${viewport.name}: ${flags.join(', ')}`)
        consoleErrors.length = 0

        console.log(
          `${flags.length ? 'FAIL' : 'ok  '}  ${theme.padEnd(9)} ${route.padEnd(11)} ${viewport.name.padEnd(8)}` +
            ` body ${audit.body}  head ${audit.heading}  large ${audit.large}  ${file}`,
        )
      }
    }

    await context.close()
  }

  await browser.close()

  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const p of problems) console.log(`  - ${p}`)
    process.exit(1)
  }
  console.log('\nall themes clean at both breakpoints')
}

run()
