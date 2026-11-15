// Contrast guard for the theme tokens in src/renderer/src/styles/global.css.
//
// Why this exists: the app's secondary text (--text-faint) carries the small
// print — file mtimes and sizes, transfer percentages, the shortcut hints in the
// terminal context menu, search placeholders — and it had quietly sunk to 3.3:1
// on the dark surface and 2.5:1 on the light one. WCAG AA wants 4.5:1 for text
// under 18pt. Typecheck and the build cannot see that; only arithmetic can.
//
// It also watches the light theme's DUPLICATED definition: the explicit
// `[data-theme='light']` block and the `prefers-color-scheme` fallback are
// maintained by hand, and a token edited in one and not the other is invisible
// until someone toggles the OS theme.
//
// Run: npm run check:contrast   (wired into lint:i18n so CI covers it)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CSS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'renderer',
  'src',
  'styles',
  'global.css'
)

// Text tokens must clear AA normal text against every surface they can sit on.
const MIN_TEXT = 4.5
const TEXT_TOKENS = ['--text', '--text-dim', '--text-faint']
// Status/accent colors double as label text in badges and links, so they get the
// same floor against the base surface (dots alone would only need 3:1).
const LABEL_TOKENS = ['--accent', '--ok', '--warn', '--danger']
const SURFACES = ['--bg', '--bg-elev', '--bg-elev-2']

const BLOCKS = [
  { name: 'dark  (:root)', re: /(^|\n):root\s*\{([^}]*)\}/m, expectAll: false },
  { name: "light (:root[data-theme='light'])", re: /:root\[data-theme='light'\]\s*\{([^}]*)\}/, expectAll: true },
  { name: 'light (prefers-color-scheme)', re: /:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/, expectAll: true }
]

/** Declarations in a block, hex colors only (rgba tokens are scrims/shadows). */
function parse(body) {
  const out = new Map()
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    if (!out.has(m[1])) out.set(m[1], m[2])
  }
  return out
}

function channel(c) {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function lum(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((x) => x + x).join('')
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const css = readFileSync(CSS, 'utf8')
const parsed = []
const problems = []

for (const block of BLOCKS) {
  const m = css.match(block.re)
  if (!m) {
    problems.push(`${block.name}: block not found in global.css — did a selector change?`)
    continue
  }
  const tokens = parse(m[2] ?? m[1])
  parsed.push({ name: block.name, tokens })
  if (block.expectAll) {
    for (const t of [...TEXT_TOKENS, ...LABEL_TOKENS, ...SURFACES]) {
      if (!tokens.has(t)) problems.push(`${block.name}: ${t} is not defined here`)
    }
  }
}

for (const { name, tokens } of parsed) {
  for (const surface of SURFACES) {
    const bg = tokens.get(surface)
    if (!bg) continue
    for (const token of [...TEXT_TOKENS, ...LABEL_TOKENS]) {
      const fg = tokens.get(token)
      if (!fg) continue
      // A token only needs the floor against a surface it is actually used on;
      // LABEL_TOKENS are only checked against --bg to keep the report honest
      // about the pairs designers actually hit.
      if (LABEL_TOKENS.includes(token) && surface !== '--bg') continue
      const r = ratio(fg, bg)
      if (r < MIN_TEXT) {
        problems.push(
          `${name}: ${token} ${fg} on ${surface} ${bg} = ${r.toFixed(2)}:1 (needs ${MIN_TEXT}:1)`
        )
      }
    }
  }
}

// The two light copies must not drift apart on any token they share.
const light = parsed.filter((p) => p.name.startsWith('light'))
if (light.length === 2) {
  const [a, b] = light
  for (const key of new Set([...a.tokens.keys(), ...b.tokens.keys()])) {
    if (a.tokens.get(key) !== b.tokens.get(key)) {
      problems.push(
        `light theme copies disagree on ${key}: ${a.name}=${a.tokens.get(key)} vs ${b.name}=${b.tokens.get(key)}`
      )
    }
  }
}

if (problems.length) {
  console.error('Contrast check FAILED:\n  ' + problems.join('\n  ') + '\n')
  console.error(
    'Fix by moving the color, not by lowering the bar. Hue-preserving values that clear 4.5:1 can be found by nudging toward black (light surface) or white (dark surface).'
  )
  process.exit(1)
}

const checked = parsed.reduce((n, p) => n + p.tokens.size, 0)
console.log(`contrast check OK — ${checked} token definitions across ${parsed.length} theme blocks, AA 4.5:1 floor held.`)
