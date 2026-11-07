#!/usr/bin/env node
/**
 * Fails when the bundled main/preload code imports a *named* export that the
 * dependency (a CommonJS package) does not actually expose to ESM.
 *
 * `tsc` and `vitest` cannot catch this: types say `utils` exists, and vitest
 * transpiles CJS on the fly. Only Node's real ESM loader applies
 * cjs-module-lexer, which is what rejected `import { utils } from 'ssh2'` at
 * startup with "Named export 'utils' not found" while the build was green.
 */
import { readFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'

const files = process.argv.slice(2)
if (!files.length) files.push('out/main/index.js', 'out/preload/index.mjs')

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`)
])

// `electron` only exposes its API inside the Electron runtime; under plain Node
// the module resolves to the binary path, so checking it here is meaningless.
const RUNTIME_ONLY = new Set(['electron'])

/** `import { a, b as c } from "pkg"`, including a default binding before the
 *  braces (`import pkg, { a } from "pkg"`) — rollup emits that form when one
 *  module default-imports a package and another named-imports it. */
const NAMED = /import\s+([^;]*?)\s+from\s*["']([^"']+)["']/g
const BRACES = /\{([^}]*)\}/

let failures = 0
let checked = 0

for (const file of files) {
  let code
  try {
    code = await readFile(file, 'utf8')
  } catch {
    console.log(`skip ${file} (not built)`)
    continue
  }
  for (const match of code.matchAll(NAMED)) {
    const braces = BRACES.exec(match[1])
    if (!braces) continue
    const names = braces[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter(Boolean)
    const spec = match[2]
    if (builtins.has(spec) || RUNTIME_ONLY.has(spec) || spec.startsWith('node:') || spec.startsWith('.'))
      continue
    let mod
    try {
      mod = await import(spec)
    } catch (e) {
      console.log(`FAIL ${file}: cannot import "${spec}" — ${e.message}`)
      failures++
      continue
    }
    for (const name of names) {
      if (name === 'default' || name === 'type') continue
      checked++
      if (!(name in mod)) {
        console.log(
          `FAIL ${file}: "${spec}" has no ESM named export "${name}" — ` +
            `use a default import and reach into module.exports instead`
        )
        failures++
      }
    }
  }
}

// A zero count means the pattern stopped matching (a new bundle layout, say).
// Reporting "OK" then would hide exactly the crash this script exists for.
if (checked === 0) {
  console.error('no named imports found — the checker is not reading the bundle correctly')
  process.exit(1)
}

if (failures) {
  console.error(`\n${failures} bad named import(s) would crash at startup.`)
  process.exit(1)
}
console.log(`ESM import check OK — ${checked} named import(s) across ${files.length} file(s).`)
