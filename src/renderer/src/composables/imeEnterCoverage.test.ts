import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Enter handlers that submit something must survive a Chinese IME.
 *
 *  The bug this guards against happened repeatedly and silently: a template
 *  binds `@keydown.enter.prevent="save"` and the `.prevent` modifier cancels the
 *  keydown *before* any `isComposing` check can run — so the candidate list in a
 *  Chinese IME never commits the word, and the box looks broken to anyone typing
 *  Chinese. Handlers bound without `.prevent` but with no guard at all are the
 *  mirror image: the Enter that only picks a candidate instead saves / connects /
 *  sends.
 *
 *  So every component that handles Enter has to mention `isImeKey` (or the local
 *  `isImeEnter`, which delegates to it). A source scan can't tell whether the
 *  guard sits on the right code path, but it does catch "a new Enter handler was
 *  added and nobody thought about the IME", which is the mistake that recurred.
 *
 *  Exempt: handlers that only save an idempotent preference, where a candidate
 *  Enter is harmless.
 */
const componentsDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'components')

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : []
  )
}

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Template segment only: script code may mention these strings legitimately. */
function templateOf(source: string): string {
  const at = source.indexOf('<template>')
  return at >= 0 ? source.slice(at) : ''
}

/** Enter bound in a template. `@keyup.enter` counts too — a keyup handler runs
 *  after the IME has already committed, but it still fires on the committing
 *  Enter and acts on it. */
const ENTER_BINDING = /@key(?:down|up|press)(?:\.[a-z-]+)*\.enter\b/g

/** Files where Enter is deliberately not IME-guarded. */
const ALLOWED = new Set([
  // Idempotent preference writes: saving again with the same value is a no-op,
  // and a candidate Enter merely re-saves what is already stored.
  'SettingsDialog.vue'
])

describe('Enter handlers', () => {
  it('every component handling Enter considers the IME', () => {
    const offenders: string[] = []
    for (const file of vueFiles(componentsDir)) {
      const name = file.slice(file.lastIndexOf('\\') + 1, file.lastIndexOf('/') + 1)
      const base = file.split(/[\\/]/).pop() ?? file
      if (ALLOWED.has(base)) continue
      const raw = readFileSync(file, 'utf8')
      const tpl = templateOf(raw)
      if (!ENTER_BINDING.test(tpl)) {
        // RegExp with /g keeps lastIndex between calls — reset for the next file.
        ENTER_BINDING.lastIndex = 0
        continue
      }
      ENTER_BINDING.lastIndex = 0
      const code = withoutComments(raw)
      if (!/\bisImeKey\s*\(|\bisImeEnter\s*\(/.test(code)) offenders.push(base || name)
    }
    expect(offenders).toEqual([])
  })

  it('no Enter binding relies on the .prevent modifier', () => {
    // `.prevent` on an Enter binding cancels the composing keydown before the
    // handler's IME guard can run, so the candidate never commits. Cancel
    // inside the handler instead, after checking `isImeKey`.
    const offenders: string[] = []
    for (const file of vueFiles(componentsDir)) {
      const base = file.split(/[\\/]/).pop() ?? file
      const tpl = templateOf(readFileSync(file, 'utf8'))
      for (const m of tpl.matchAll(/@key(?:down|up|press)((?:\.[a-z-]+)*)\.enter((?:\.[a-z-]+)*)/g)) {
        const modifiers = `${m[1] ?? ''}${m[2] ?? ''}`.split('.').filter(Boolean)
        if (modifiers.includes('prevent')) offenders.push(`${base}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})