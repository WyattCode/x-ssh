import { describe, it, expect } from 'vitest'
import { bracketMultiline, redactForTrace } from './imeBridge'

const DEL = '\x7f'

describe('bracketMultiline', () => {
  const tidy = '今天我要吃个饭：\n1. 米饭\n2. 土豆'

  it('sends multi-line text as a bracketed paste when the app asked for it', () => {
    expect(bracketMultiline(tidy, true)).toBe(`\x1b[200~${tidy}\x1b[201~`)
  })

  it('keeps the erase part outside the markers', () => {
    expect(bracketMultiline(DEL.repeat(7) + tidy, true)).toBe(`${DEL.repeat(7)}\x1b[200~${tidy}\x1b[201~`)
  })

  it('leaves the text alone when bracketed paste is off (a raw LF is all there is)', () => {
    expect(bracketMultiline(tidy, false)).toBe(tidy)
  })

  it('leaves single-line text and a bare line break alone', () => {
    expect(bracketMultiline('一行文字', true)).toBe('一行文字')
    expect(bracketMultiline('\n', true)).toBe('\n')
    expect(bracketMultiline(DEL + '\n', true)).toBe(DEL + '\n')
  })

  it('handles a tail-only commit that starts with a line break', () => {
    expect(bracketMultiline('\n3. 水饺', true)).toBe('\x1b[200~\n3. 水饺\x1b[201~')
  })
})

describe('redactForTrace', () => {
  it('never shows a typed key', () => {
    expect(redactForTrace('p', 'keydown')).toBe('(key)')
    expect(redactForTrace('\r', 'keydown')).toBe('(key)')
    expect(redactForTrace('é', 'keypress')).toBe('(key)')
  })

  it('shows backspace (it reveals length, not content)', () => {
    expect(redactForTrace(DEL, 'keydown')).toBe('\\x7f')
  })

  it('never shows terminal reports or escape sequences', () => {
    expect(redactForTrace('\x1b[<35;12;5M', 'mousemove')).toBe('(esc)')
    expect(redactForTrace('\x1b[A', 'keydown')).toBe('(esc)')
    expect(redactForTrace('\x1b[200~secret\x1b[201~', 'paste')).toBe('(esc)')
  })

  it('never shows pasted or dropped text', () => {
    expect(redactForTrace('hunter2-api-token', 'paste')).toBe('(paste, 17 chars)')
    expect(redactForTrace('/home/me/key.pem', 'drop')).toBe('(paste, 16 chars)')
  })

  it('shows IME text, which is what the trace exists for', () => {
    expect(redactForTrace('今天要吃饭', undefined)).toBe('今天要吃饭')
    expect(redactForTrace('一\n二', 'input')).toBe('一\\n二')
    // A composition forced out by a fake key is long: a hand cannot type that.
    expect(redactForTrace('今天要吃饭，第一吃西瓜', 'keydown')).toBe('今天要吃饭，第一吃西瓜')
  })
})
