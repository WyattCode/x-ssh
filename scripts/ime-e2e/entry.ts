// Test page for scripts/ime-e2e/run.cjs: real xterm.js + the real IME bridge.
import { Terminal } from '@xterm/xterm'
import { attachImeBridge } from '../../src/renderer/src/lib/imeBridge'

// Stand-in for the preload API the bridge talks to (tracing on, lines collected).
const traceLines: string[] = []
let traceOn = true
;(window as unknown as { api: unknown }).api = {
  ime: { traceEnabled: async () => traceOn, trace: (l: string) => { traceLines.push(l) } }
}

const term = new Terminal({ cols: 80, rows: 10 })
term.open(document.getElementById('term') as HTMLElement)

// What the (pretend) remote shell does with the bytes we send: a readline-like
// single line where DEL erases one character, CR/LF outside a paste SUBMITS the
// line (so a raw LF from a multi-line commit shows up as `rawLf`), and bracketed
// paste markers delimit text that is only inserted.
const wire: string[] = []
let line: string[] = []
let inPaste = false
let rawLf = 0
const send = (data: string): void => {
  wire.push(data)
  for (const part of data.split(/(\x1b\[20[01]~)/)) {
    if (part === '\x1b[200~') { inPaste = true; continue }
    if (part === '\x1b[201~') { inPaste = false; continue }
    const text = part.replace(
      /\x1b\[M[\s\S]{3}|\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bO[\s\S]|\x1b[\s\S]/g,
      ''
    )
    for (const ch of Array.from(text)) {
      if (ch === '\x7f') line.pop()
      else if (ch === '\r' || ch === '\n') {
        if (inPaste) line.push(ch)
        else { if (ch === '\n') rawLf++; line = [] }
      } else if (ch >= ' ') line.push(ch)
    }
  }
}
const bridge = attachImeBridge(term, send, new AbortController().signal)
term.focus()

const events: string[] = []
const ta0 = term.textarea as HTMLTextAreaElement
for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input'] as const) {
  ta0.addEventListener(type, (e) => {
    const ie = e as InputEvent
    events.push(`${type} ${ie.inputType ?? ''} ${JSON.stringify(ie.data ?? '')}`)
  }, true)
}

// xterm empties its textarea when it loses focus, which silently resets a scenario
// in progress. Count blurs so the runner can discard such a run instead of
// reporting a failure the code did not cause.
let blurs = 0
ta0.addEventListener('blur', () => { blurs++ }, true)

Object.assign(window, {
  __setTrace: (on: boolean) => { traceOn = on },
  __blurs: () => blurs,
  __hasFocus: () => document.hasFocus() && document.activeElement === ta0,
  __remote: () => line.join(''),
  __wire: () => wire.slice(),
  __rawLf: () => rawLf,
  __events: () => events.splice(0),
  __trace: () => traceLines.splice(0),
  __reset: () => {
    wire.length = 0
    line = []
    inPaste = false
    rawLf = 0
    traceLines.length = 0
    blurs = 0
    ;(term.textarea as HTMLTextAreaElement).value = ''
  },
  __ta: () => (term.textarea as HTMLTextAreaElement).value,
  __caretToEnd: () => {
    const ta = term.textarea as HTMLTextAreaElement
    ta.setSelectionRange(ta.value.length, ta.value.length)
  },
  __selectAll: () => {
    const ta = term.textarea as HTMLTextAreaElement
    ta.setSelectionRange(0, ta.value.length)
  },
  /** The application turning bracketed paste on/off, as bash and Codex do. */
  __bracketed: (on: boolean) => new Promise<void>((r) => term.write(on ? '\x1b[?2004h' : '\x1b[?2004l', r)),
  /** The application asking for mouse reports, as a TUI does. */
  __mouseTracking: (on: boolean) =>
    new Promise<void>((r) => term.write(on ? '\x1b[?1003h\x1b[?1006h' : '\x1b[?1003l\x1b[?1006l', r)),
  /** The app's own paste, called later from a timer (after an awaited confirm dialog). */
  __pasteLater: (text: string) => new Promise<void>((r) => setTimeout(() => { bridge.paste(text); r() }, 0))
})
