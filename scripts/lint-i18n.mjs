#!/usr/bin/env node
// i18n consistency linter.
//
// - 校验 lib/i18n.ts 中 zh/en/zhTW 三个字典的键集合完全一致(zhTW 运行时缺键会回退到 zh,
//   但这里仍要求补全,避免繁体界面里混入简体)。
// - 扫描源码,确保所有静态调用的 t('...') / tt('...') / $t('...')
//   密钥在字典中真实存在(动态模板键 tab.* group.* sck.* 以及对应 Hint 除外)。
//
// 用法: node scripts/lint-i18n.mjs   (或 npm run lint:i18n)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const i18n = path.join(root, 'src', 'renderer', 'src', 'lib', 'i18n.ts')
const src = path.join(root, 'src')

const dictSrc = fs.readFileSync(i18n, 'utf8')

/** Extract the body of a `const <name>: Dict = { ... }` block. */
function bodyOf(name) {
  const m = dictSrc.match(new RegExp(`const\\s+${name}\\s*:\\s*Dict\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`Cannot locate dict "${name}" in ${i18n}`)
  return m[1]
}

/** Keys → value for a dict body (simple single/double quoted string values). */
function parse(body) {
  const out = {}
  const re = /'([\w.]+)'\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g
  let m
  while ((m = re.exec(body)) && m[0].includes(':')) {
    out[m[1]] = m[2] ?? m[3]
  }
  return out
}

const zh = parse(bodyOf('zh'))
const en = parse(bodyOf('en'))
const zhTW = parse(bodyOf('zhTW'))

let errors = 0
const report = (msg) => {
  errors++
  console.error(`  ✖ ${msg}`)
}

console.log(`zh keys: ${Object.keys(zh).length}`)
console.log(`en keys: ${Object.keys(en).length}`)
console.log(`zhTW keys: ${Object.keys(zhTW).length}`)

// 1) key-set symmetry
for (const k of Object.keys(zh)) if (!(k in en)) report(`only in zh: \`${k}\``)
for (const k of Object.keys(en)) if (!(k in zh)) report(`only in en: \`${k}\``)
for (const k of Object.keys(zh)) if (!(k in zhTW)) report(`missing in zhTW: \`${k}\``)
for (const k of Object.keys(zhTW)) if (!(k in zh)) report(`only in zhTW: \`${k}\``)

// 2) nested placeholders must match: t('a.b', { n }) vs value placeholders
const ph = (v) => [...new Set([...(v.matchAll(/\{(\w+)\}/g))].map((x) => x[1]))].sort()
for (const k of Object.keys(zh)) {
  const zp = ph(zh[k]).join(',')
  const ep = ph(en[k]).join(',')
  if (zp !== ep) report(`placeholder mismatch for \`${k}\`: zh{${zp}} en{${ep}}`)
  if (k in zhTW) {
    const tp = ph(zhTW[k]).join(',')
    if (zp !== tp) report(`placeholder mismatch for \`${k}\`: zh{${zp}} zhTW{${tp}}`)
  }
}

// 3) verify static key references used in code exist
const dynamic = ['tab.', 'group.', 'sck.', 'tabTitle.', 'sckHint.']
const keyRe = /\b(?:t|tt|\$t)\(\s*['"]([A-Za-z0-9_.-]+)['"]/g
let scanned = 0
for (const file of walk(src)) {
  if (!/\.(vue|ts|tsx|js|jsx)$/.test(file)) continue
  const code = fs.readFileSync(file, 'utf8')
  const refs = new Set()
  let m
  while ((m = keyRe.exec(code))) refs.add(m[1])
  for (const ref of refs) {
    if (dynamic.some((p) => ref.startsWith(p))) continue
    scanned++
    if (!(ref in zh)) report(`missing key \`${ref}\` (referenced in ${rel(file)})`)
  }
}
console.log(`static key references checked: ${scanned}`)

if (errors) {
  console.error(`\ni18n lint FAILED with ${errors} problem(s).`)
  process.exit(1)
}
console.log('\ni18n lint OK — zh/en/zhTW symmetric, placeholders match, all static keys resolve.')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(full, out)
    } else out.push(full)
  }
  return out
}

function rel(p) {
  return path.relative(root, p).replace(/\\/g, '/')
}
