/**
 * Tiny, dependency-free syntax highlighter for the in-app file editor.
 * Produces HTML with classed spans; the caller renders it behind a transparent
 * <textarea> (the "textarea over highlighted pre" technique). Deliberately
 * lightweight — it highlights enough to be useful without the weight of a full
 * grammar engine, and keeps the editor snappy on large files.
 */

/** Line comment markers per language family. */
interface LangSpec {
  /** Regex that matches a line comment (from its start). */
  line: string
  /** Regex that matches a block comment, or '' if the language has none. */
  block?: string
  /** Space-separated keywords for this language. */
  keywords: string
  /** Space-separated built-ins / constants to color differently. */
  builtins?: string
  /** Whether to recognize numeric literals. */
  numbers?: boolean
  /** Whether to recognize strings with escapes. */
  strings?: boolean
  /** Whether to recognize i18n-style identifiers like `a.b.c`. */
  member?: boolean
}

/** Language family specs. Each is a simple, order-sensitive tokenizer. */
const LANGS: Record<string, LangSpec> = {
  js: {
    line: '//',
    block: '/\\*[\\s\\S]*?\\*/',
    keywords:
      'var let const function return if else for while do switch case break continue new delete typeof instanceof in of class extends super this void yield async await import export default throw try catch finally static get set',
    builtins:
      'console window document this true false null undefined NaN Infinity arguments Object Array String Number Boolean Promise Map Set Symbol JSON Math RegExp Error Date',
    numbers: true,
    strings: true
  },
  ts: {
    line: '//',
    block: '/\\*[\\s\\S]*?\\*/',
    keywords:
      'var let const function return if else for while do switch case break continue new delete typeof instanceof in of class extends super this void yield async await import export default throw try catch finally static get set interface type enum namespace declare abstract implements readonly as is satisfies keyof infer unknown never any string number boolean',
    builtins:
      'console window document true false null undefined NaN Infinity arguments Object Array String Number Boolean Promise Map Set Symbol JSON Math RegExp Error Date this',
    numbers: true,
    strings: true,
    member: true
  },
  json: {
    line: '',
    keywords: 'true false null',
    numbers: true,
    strings: true
  },
  py: {
    line: '#',
    keywords:
      'def return if elif else for while import from as class try except finally raise with lambda yield pass break continue global nonlocal assert del in is not and or async await None True False self',
    builtins: 'print len range input int str list dict set tuple float bool None True False',
    numbers: true,
    strings: true
  },
  sh: {
    line: '#',
    keywords:
      'if then else elif fi for while do done case esac function in not and or return exit set export local readonly shift source echo cd pwd ls rm mv cp cat grep sed awk sudo bash zsh',
    builtins: 'true false printf test',
    numbers: true,
    strings: true
  },
  yml: {
    line: '#',
    keywords: 'true false null yes no on off',
    numbers: true,
    strings: true
  },
  xml: {
    line: '',
    block: '<!--[\\s\\S]*?-->',
    keywords: '',
    strings: true
  },
  css: {
    line: '',
    block: '/\\*[\\s\\S]*?\\*/',
    keywords: '',
    numbers: true,
    strings: true
  },
  sql: {
    line: '--',
    block: '/\\*[\\s\\S]*?\\*/',
    keywords:
      'select from where insert update delete into values set create table alter drop index view join left right inner outer on as order by group having limit offset union all distinct and or not null primary key foreign references default',
    numbers: true,
    strings: true
  }
}

/** Map a file extension to a language key. */
export function langFromName(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'js'
    case 'ts':
    case 'tsx':
      return 'ts'
    case 'json':
    case 'jsonc':
      return 'json'
    case 'py':
    case 'pyw':
      return 'py'
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'shell':
      return 'sh'
    case 'yml':
    case 'yaml':
      return 'yml'
    case 'xml':
    case 'html':
    case 'htm':
    case 'vue':
    case 'svg':
      return 'xml'
    case 'css':
    case 'scss':
    case 'less':
      return 'css'
    case 'sql':
      return 'sql'
    default:
      return ''
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function span(cls: string, body: string): string {
  return `<span class="${cls}">${body}</span>`
}

/**
 * Highlight source code, returning escaped HTML (spans classed `k` (keyword),
 * `s` (string), `c` (comment), `n` (number), `b` (builtin), `m` (member)).
 * Unknown languages return plain escaped text.
 */
export function highlight(code: string, lang: string): string {
  const spec = LANGS[lang]
  if (!spec) return escapeHtml(code)
  const out: string[] = []
  let i = 0
  const n = code.length
  const kw = new Set(spec.keywords.split(/\s+/))
  const built = new Set((spec.builtins ?? '').split(/\s+/).filter((x) => x && x.length > 1))
  while (i < n) {
    const ch = code[i]
    // Line comment.
    if (spec.line && code.startsWith(spec.line, i)) {
      const end = code.indexOf('\n', i)
      const stop = end < 0 ? n : end
      out.push(span('c', escapeHtml(code.slice(i, stop))))
      i = stop
      continue
    }
    // Block comment.
    if (spec.block) {
      const block = blockAt(code, i)
      if (block) {
        out.push(span('c', escapeHtml(block)))
        i += block.length
        continue
      }
    }
    // String.
    if (spec.strings && (ch === '"' || ch === "'" || ch === '`')) {
      const str = readString(code, i, ch)
      out.push(span('s', escapeHtml(str)))
      i += str.length
      continue
    }
    // Number.
    if (spec.numbers && /[0-9]/.test(ch)) {
      let j = i
      while (j < n && /[0-9a-fA-F._xXbBoO]/.test(code[j])) j++
      out.push(span('n', escapeHtml(code.slice(i, j))))
      i = j
      continue
    }
    // Word.
    if (/[A-Za-z_$@]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$@]/.test(code[j])) j++
      const word = code.slice(i, j)
      const b = spec.builtins?.includes(word) && word.trim().length > 1
      if (kw.has(word)) out.push(span('k', escapeHtml(word)))
      else if (b) out.push(span('b', escapeHtml(word)))
      else out.push(escapeHtml(word))
      i = j
      // Member access `foo.bar` — highlight the member as a member.
      if (spec.member && code[j] === '.' && /[A-Za-z_$]/.test(code[j + 1] ?? '')) {
        let k = j + 1
        while (k < n && /[A-Za-z0-9_$]/.test(code[k])) k++
        out.push('<span class="p">.</span>')
        out.push(span('m', escapeHtml(code.slice(j + 1, k))))
        i = k
      }
      continue
    }
    // Punctuation / whitespace.
    out.push(escapeHtml(ch))
    i++
  }
  return out.join('')
}

/** Reads a block comment starting exactly at `i`; returns '' if none. */
function blockAt(code: string, i: number): string {
  for (const open of ['/*', '<!--']) {
    if (code.startsWith(open, i)) {
      const close = open === '/*' ? '*/' : '-->'
      const end = code.indexOf(close, i + open.length)
      const stop = end < 0 ? code.length : end + close.length
      return code.slice(i, stop)
    }
  }
  return ''
}

/** Reads a string literal starting at `i`; handles backslash escapes & newlines. */
function readString(code: string, i: number, quote: string): string {
  let j = i + 1
  const n = code.length
  let escaped = false
  while (j < n) {
    const c = code[j]
    if (escaped) {
      escaped = false
      j++
      continue
    }
    if (c === '\\') {
      escaped = true
      j++
      continue
    }
    if (c === quote) return code.slice(i, j + 1)
    j++
  }
  return code.slice(i, j)
}
