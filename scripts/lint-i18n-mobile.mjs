#!/usr/bin/env node
// Mobile-side i18n consistency check.
//
// Mirrors scripts/lint-i18n.mjs (which covers the desktop renderer) for the
// Android app. Two things are checked:
//
//  1. res/values/strings.xml and res/values-en/strings.xml declare the same key
//     set with the same format placeholders — a missing translation falls back
//     to Chinese silently at runtime, which is exactly the drift the desktop
//     linter exists to catch.
//  2. Every `R.string.<name>` referenced from Kotlin exists in the default
//     resource file, so a rename can't leave a dangling reference.
//
// Chinese literals still inline in the Compose code are reported as a count
// (a warning, not an error) — the migration is in progress, and this number is
// how it shrinks. Run with `--strict` to make them fail the build.
//
// 用法: node scripts/lint-i18n-mobile.mjs [--strict]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const res = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res')
const kotlinDir = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'kotlin')
const strict = process.argv.includes('--strict')

const CJK = /[\u4e00-\u9fff]/

let errors = 0
const report = (msg) => {
  errors++
  console.error(`  \u2716 ${msg}`)
}

/** name -> value for a strings.xml, or null when the file is absent. */
function readStrings(file) {
  if (!fs.existsSync(file)) return null
  const xml = fs.readFileSync(file, 'utf8')
  const out = {}
  const re = /<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g
  let m
  while ((m = re.exec(xml))) out[m[1]] = m[2]
  return out
}

const zhFile = path.join(res, 'values', 'strings.xml')
const enFile = path.join(res, 'values-en', 'strings.xml')
const zh = readStrings(zhFile)
const en = readStrings(enFile)

if (!zh) {
  console.error(`cannot read ${path.relative(root, zhFile)}`)
  process.exit(1)
}

console.log(`mobile zh strings: ${Object.keys(zh).length}`)
console.log(`mobile en strings: ${en ? Object.keys(en).length : '(no values-en yet)'}`)

if (en) {
  for (const k of Object.keys(zh)) if (!(k in en)) report(`only in values: \`${k}\``)
  for (const k of Object.keys(en)) if (!(k in zh)) report(`only in values-en: \`${k}\``)

  // Placeholders must agree: a translated string missing %1$s renders a sentence
  // with a hole in it (or throws, depending on the formatter).
  const ph = (v) => [...new Set([...v.matchAll(/%(\d+\$)?[sd]/g)].map((x) => x[0]))].sort().join(',')
  for (const k of Object.keys(zh)) {
    if (!(k in en)) continue
    const zp = ph(zh[k])
    const ep = ph(en[k])
    if (zp !== ep) report(`placeholder mismatch for \`${k}\`: zh[${zp}] en[${ep}]`)
  }
}

// 2. R.string references resolve.
let refs = 0
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

for (const file of walk(kotlinDir)) {
  if (!file.endsWith('.kt')) continue
  if (file.includes(`${path.sep}uniffi${path.sep}`)) continue // generated
  const code = fs.readFileSync(file, 'utf8')
  const seen = new Set()
  for (const m of code.matchAll(/\bR\.string\.([A-Za-z0-9_]+)/g)) seen.add(m[1])
  for (const name of seen) {
    refs++
    if (!(name in zh)) {
      report(`missing string resource \`${name}\` (referenced in ${rel(file)})`)
    }
  }
}
console.log(`R.string references checked: ${refs}`)

// 3. Report the remaining inline Chinese UI literals (not an error unless --strict).
const patterns = [
  /\bText\(\s*"([^"]*)"\s*(?:,|\))/g,
  /\b(?:placeholder|title|label|contentDescription|subtitle)\s*=\s*"([^"]*)"/g
]
let inline = 0
for (const file of walk(kotlinDir)) {
  if (!file.endsWith('.kt')) continue
  const code = fs.readFileSync(file, 'utf8')
  for (const re of patterns) {
    for (const m of code.matchAll(re)) if (CJK.test(m[1])) inline++
  }
}
console.log(`inline Chinese UI literals still to migrate: ${inline}`)
if (strict && inline > 0) {
  report(`${inline} inline Chinese UI literal(s) — see docs/mobile for the migration notes`)
}

if (errors) {
  console.error(`\nmobile i18n lint FAILED with ${errors} problem(s).`)
  process.exit(1)
}
console.log('\nmobile i18n lint OK.')

function rel(p) {
  return path.relative(root, p).replace(/\\/g, '/')
}