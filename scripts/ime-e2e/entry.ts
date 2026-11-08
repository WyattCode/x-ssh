// Test page for scripts/ime-e2e/run.mjs: real xterm.js + the real IME bridge.
import { Terminal } from '@xterm/xterm'
import { attachImeBridge } from '../../src/renderer/src/lib/imeBridge'

const term = new Terminal({ cols: 80, rows: 10 })
term.open(document.getElementById('term') as HTMLElement)

// What the (pretend) remote shell does with the bytes we send: a readline-like
// single line where DEL erases one character.
const wire: string[] = []
let line: string[] = []
const send = (data: string): void => {
  wire.push(data)
  for (const ch of Array.from(data)) {
    if (ch === '\x7f') line.pop()
    else if (ch === '\r') line = []
    else if (ch >= ' ') line.push(ch)
  }
}
attachImeBridge(term, send, new AbortController().signal)
term.focus()

Object.assign(window, {
  __remote: () => line.join(''),
  __wire: () => wire.slice(),
  __reset: () => {
    wire.length = 0
    line = []
    const ta = term.textarea as HTMLTextAreaElement
    ta.value = ''
  },
  __ta: () => (term.textarea as HTMLTextAreaElement).value,
  __caretToEnd: () => {
    const ta = term.textarea as HTMLTextAreaElement
    ta.setSelectionRange(ta.value.length, ta.value.length)
  },
  __selectAll: () => {
    const ta = term.textarea as HTMLTextAreaElement
    ta.setSelectionRange(0, ta.value.length)
  }
})
