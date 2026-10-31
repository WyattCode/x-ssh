#!/usr/bin/env node
// 主进程硬编码中文守卫。
//
// 交接文档里 M3.115 / M3.116 / M3.149–M3.152 那几十轮修的是同一类 bug：主进程把
// 面向用户的文案写成中文字面量，英文界面就漏出中文（`连接已断开`、`打包失败`、
// `窗口未就绪` 这类）。约定是：失败返回稳定的 kebab 机器码，文案由渲染层按 code 出
// （connectFailure.ts / keyError.ts / publishError.ts）。这个守卫把那条约定变成 CI 上
// 会当场失败的检查，否则修完一轮又会漏回来。
//
// 豁免写法：
//   // i18n-allow-file                      整份文件（friendlyError.ts 本身就是中文映射表）
//   /* i18n-allow-start */ … /* i18n-allow-end */  一段区间（主进程自带的那份三语表）
//   // i18n-allow-next                       放过下一行
//   行尾写 // i18n-allow                     放过该行
//
// 用法: node scripts/lint-i18n-main.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const target = path.join(root, 'src', 'main')

const CJK = /[㐀-䶿一-鿿豈-﫿　-〿＀-￯]/
const FILE_ALLOW = /i18n-allow-file/
const RANGE_START = /i18n-allow-start/
const RANGE_END = /i18n-allow-end/
const LINE_ALLOW = /i18n-allow\b/
const NEXT_ALLOW = /i18n-allow-next\b/

/** Lines whose CJK string literals are excused by an explicit marker. */
function exemptLines(lines) {
  const skip = new Set()
  let inRange = false
  lines.forEach((line, i) => {
    if (RANGE_END.test(line)) inRange = false
    if (inRange || LINE_ALLOW.test(line)) skip.add(i)
    if (RANGE_START.test(line)) inRange = true
    if (NEXT_ALLOW.test(line)) skip.add(i + 1)
  })
  return skip
}

/**
 * Collect CJK string literals with their line numbers.
 *
 * A single char scan with explicit states (comment / block comment / three
 * string flavours) rather than a regex, because the false-positive direction
 * that matters here is a Chinese *comment* passing for a user-facing literal —
 * comments are the bulk of this codebase and must never be reported.
 */
function literals(src) {
  const hits = []
  let line = 1
  let i = 0
  let cur = ''
  let curLine = 1
  const n = src.length
  while (i < n) {
    const c = src[i]
    const nx = src[i + 1]
    if (c === '\n') {
      line++
      i++
      continue
    }
    if (c === '/' && nx === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && nx === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      const startLine = line
      cur = ''
      curLine = startLine
      i++
      while (i < n) {
        const s = src[i]
        if (s === '\\') {
          cur += s + (src[i + 1] ?? '')
          if (src[i + 1] === '\n') line++
          i += 2
          continue
        }
        if (s === quote) {
          i++
          break
        }
        if (s === '\n') {
          if (quote !== '`') {
            // Unterminated single/double quote: bail out of the string so a
            // stray apostrophe in prose cannot swallow the rest of the file.
            i++
            break
          }
          line++
        }
        cur += s
        i++
      }
      if (CJK.test(cur)) hits.push({ line: curLine, text: cur })
      continue
    }
    i++
  }
  return hits
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) out.push(full)
  }
  return out
}

const findings = []
let files = 0
for (const file of walk(target).sort()) {
  files++
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  if (lines.slice(0, 8).some((l) => FILE_ALLOW.test(l))) continue
  const skip = exemptLines(lines)
  for (const hit of literals(src)) {
    if (skip.has(hit.line - 1)) continue
    findings.push(`${rel}:${hit.line}: ${JSON.stringify(hit.text.slice(0, 60))}`)
  }
}

if (findings.length) {
  console.error(
    `\n主进程里出现 ${findings.length} 处中文字符串字面量（${files} 个文件已扫描）。\n` +
      '面向用户的失败要返回稳定机器码，文案放到渲染层字典里按 code 出：\n' +
      '  连接类 → lib/connectFailure.ts  密钥类 → lib/keyError.ts  发布公钥 → lib/publishError.ts\n' +
      '确实需要留在主进程的中文（OS 自绘的菜单/对话框、或既有 code 的调试串）请显式豁免：\n' +
      '  // i18n-allow-next   或行尾 // i18n-allow   或整份文件 // i18n-allow-file\n'
  )
  for (const f of findings) console.error(`  ✖ ${f}`)
  process.exit(1)
}
console.log(`main-process i18n guard OK — ${files} files, no hard-coded user-facing Chinese literals.`)
