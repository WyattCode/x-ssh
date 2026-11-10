import { describe, it, expect } from 'vitest'
import { bracketMultiline, redactForTrace, traceShape } from './imeBridge'

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

  it('records backspace as a shape (length, not content)', () => {
    expect(redactForTrace(DEL, 'keydown')).toMatchObject({ chars: 1, dels: 1 })
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

  it('records the shape of an IME commit, never its text', () => {
    // Tracing exists to answer "how many commits, how long, did we erase" —
    // never "what did they type". The text used to be logged verbatim, which
    // put a password typed into a Chinese IME at a sudo prompt into the file.
    const out = JSON.stringify(redactForTrace('今天要吃饭', undefined))
    expect(out).not.toContain('今天')
    expect(out).toContain('"chars":5')

    const multi = JSON.stringify(redactForTrace('一\n二', 'input'))
    expect(multi).not.toContain('一')
    expect(multi).toContain('"breaks":1')

    // A composition forced out by a fake key is long: a hand cannot type that.
    const forced = JSON.stringify(redactForTrace('今天要吃饭，第一吃西瓜', 'keydown'))
    expect(forced).not.toContain('西瓜')
    expect(forced).toContain('"chars":11')
  })
})

describe('traceShape', () => {
  it('keeps the shape and drops the content', () => {
    const shape = traceShape('hunter2密码') as Record<string, unknown>
    expect(shape).toMatchObject({ chars: 9, dels: 0, breaks: 0, esc: false })
    expect(JSON.stringify(shape)).not.toContain('hunter2')
    expect(JSON.stringify(shape)).not.toContain('密码')
  })

  it('counts what the log needs: erasures, line breaks, escapes', () => {
    expect(traceShape(`${DEL}${DEL}abc`)).toMatchObject({ chars: 5, dels: 2 })
    expect(traceShape('a\nb\r\nc')).toMatchObject({ chars: 6, breaks: 3 })
    expect(traceShape('\x1b[200~x\x1b[201~')).toMatchObject({ esc: true })
  })

  it('gives the same text the same id and different text a different one', () => {
    const id = (t: string): unknown => (traceShape(t) as Record<string, unknown>).id
    expect(id('同一句话')).toBe(id('同一句话'))
    expect(id('同一句话')).not.toBe(id('另一句话'))
  })

  it('passes null through', () => {
    expect(traceShape(null)).toBeNull()
    expect(traceShape(undefined)).toBeUndefined()
  })
})
