import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Modal surfaces must keep the keyboard inside (see composables/focusTrap):
 *  without a trap Tab walks into the page behind and Esc stops arriving.
 *
 *  This is a source scan, not a render test: it catches "a new dialog was added
 *  and nobody wired the trap" and "somebody removed the call", which is the
 *  mistake that actually happened twice. It cannot tell whether the ref points
 *  at the right element. */
const MODAL_CLASSES = [
  'overlay',
  'layer',
  'key-layer',
  'pm-overlay',
  'fd-overlay',
  'lock-overlay',
  'tm-overlay',
  'rp-overlay',
  'kp-overlay',
  'fw-overlay',
  'dlg-layer',
  'sv-backdrop'
]

/** Modals that deliberately do not trap. TransferPanel is a side panel the user
 *  drags files into, so focus must stay usable in the panes behind it. */
const ALLOWED = new Set(['TransferPanel.vue'])

const componentsDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'components')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : []
  )
}

function declaresModal(source: string): boolean {
  // Only the template counts: a script may mention the selector string
  // ("[aria-modal=\"true\"], .overlay") without rendering any dialog itself.
  const at = source.indexOf('<template>')
  const tpl = at >= 0 ? source.slice(at) : ''
  if (/aria-modal="true"/.test(tpl) || /role="dialog"/.test(tpl)) return true
  // Whole class names only: a substring test would also catch `.ctx-overlay`
  // and `.pop-overlay`, which are context-menu backdrops and must not trap.
  const classes = Array.from(tpl.matchAll(/class="([^"]*)"/g)).flatMap((m) => m[1].split(/\s+/))
  return classes.some((c) => MODAL_CLASSES.includes(c))
}

/** Comments removed: a commented-out call must not satisfy the check (the first
 *  version matched "// useFocusTrap(...)" and passed with no trap installed). */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('modal surfaces', () => {
  it('every dialog that declares itself modal installs the focus trap', () => {
    const missing = vueFiles(componentsDir)
      .filter((f) => !ALLOWED.has(f.split(/[\\/]/).pop() ?? ''))
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        return declaresModal(src) && !withoutComments(src).includes('useFocusTrap(')
      })
      .map((f) => f.split(/[\\/]/).pop())

    expect(missing, `these components look modal but never call useFocusTrap: ${missing.join(', ')}`).toEqual([])
  })

  it('the scan actually finds the dialogs it is meant to check', () => {
    // A guard on the guard: if the class list or the regex rots, the check above
    // would pass while covering nothing (the same shape as a broken negative
    // control).
    const found = vueFiles(componentsDir).filter((f) => declaresModal(readFileSync(f, 'utf8')))
    expect(found.length).toBeGreaterThanOrEqual(10)
  })
})