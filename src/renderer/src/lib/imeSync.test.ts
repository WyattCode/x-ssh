import { describe, it, expect } from 'vitest'
import { createImeMirror } from './imeSync'

/**
 * Replays the real chain:
 *   - `xterm()` is `term.onData` → the mirror decides what to write, and the
 *     app writes exactly that. (xterm does NOT send by itself; a revision of
 *     this module assumed it did and swallowed every keystroke.)
 *   - `sync()` is the DOM input / compositionend catch-up.
 * Everything sent is replayed through a minimal line editor standing in for the
 * remote shell.
 */
function harness() {
  const mirror = createImeMirror()
  const wire: string[] = []
  let value = ''
  const push = (s: string): void => {
    if (s) wire.push(s)
  }
  return {
    mirror,
    wire,
    /** `term.onData`: the app sends whatever the mirror returns. */
    xterm(data: string, opts: { eventType?: string; settled?: string } = {}): void {
      push(
        mirror.input(data, {
          settled: opts.settled ?? value,
          eventType: opts.eventType ?? 'input'
        })
      )
    },
    /** The input/compositionend catch-up path. */
    sync(textarea = value): void {
      push(mirror.sync(textarea))
    },
    remote(): string {
      let line: string[] = []
      for (const raw of wire) {
        const s = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        for (const ch of Array.from(s)) {
          if (ch === '\x7f') line.pop()
          else if (ch === '\r') line = []
          else if (ch >= ' ') line.push(ch)
        }
      }
      return line.join('')
    },
    set value(v: string) {
      value = v
    },
    get value(): string {
      return value
    }
  }
}

describe('createImeMirror', () => {
  it('sends every plain keystroke', () => {
    // The regression this guards: a revision returned '' for all plain text,
    // so typing English produced nothing at all.
    const m = createImeMirror()
    expect(m.input('a', { settled: 'a', eventType: 'keydown' })).toBe('a')
    expect(m.input('hello', { settled: 'hello', eventType: 'input' })).toBe('hello')

    const h = harness()
    h.value = 'a'
    h.xterm('a')
    h.value = 'ab'
    h.xterm('b')
    expect(h.remote()).toBe('ab')
  })

  it('sends control keys unchanged', () => {
    const m = createImeMirror()
    expect(m.input('\x1b[A', { settled: '', eventType: 'keydown' })).toBe('\x1b[A')
    expect(m.input('\t', { settled: '', eventType: 'keydown' })).toBe('\t')
    expect(m.input('\x03', { settled: '', eventType: 'keydown' })).toBe('\x03')
    expect(m.input('\r', { settled: '', eventType: 'keydown' })).toBe('\r')
  })

  it('sends a typed word exactly once', () => {
    const h = harness()
    h.value = 'ls'
    h.xterm('l')
    h.xterm('s')
    h.xterm('\r', { eventType: 'keydown' })
    expect(h.remote()).toBe('')
    expect(h.wire.join('')).toBe('ls\r')
  })

  it('commits a dictated sentence once, not twice', () => {
    const h = harness()
    h.value = '你好'
    h.xterm('你好')
    // compositionend for the same text must not add a second copy.
    h.sync('你好')
    expect(h.remote()).toBe('你好')
    expect(h.wire).toEqual(['你好'])
  })

  it('does not duplicate consecutive dictated sentences', () => {
    const h = harness()
    h.value = '第一句。'
    h.xterm('第一句。')
    h.sync('第一句。')
    h.value = '第二句。'
    h.xterm('第二句。')
    h.sync('第二句。')
    expect(h.remote()).toBe('第一句。第二句。')
  })

  it('sends text xterm never emitted for the commit', () => {
    // Some voice IMEs write straight into the textarea without an onData.
    const h = harness()
    h.value = '接着说'
    h.sync('接着说')
    expect(h.remote()).toBe('接着说')
  })

  it('does not resend a long dictation when the catch-up fires late', () => {
    const h = harness()
    const sentence = '默认把 API key 写进去'
    h.value = sentence
    h.xterm(sentence)
    h.value = sentence
    h.sync(sentence)
    expect(h.remote()).toBe(sentence)
  })

  it('starts a fresh line after Enter', () => {
    const h = harness()
    h.value = '发送'
    h.xterm('发送')
    h.value = ''
    h.xterm('\r', { eventType: 'keydown' })
    h.value = '下一条'
    h.xterm('下一条')
    expect(h.remote()).toBe('下一条')
  })

  it('tracks backspace so the catch-up sends only the new tail', () => {
    const h = harness()
    h.value = '你好'
    h.xterm('你好')
    // A real backspace shortens the textarea too.
    h.value = '你'
    h.xterm('\x7f', { eventType: 'keydown' })
    h.value = '你世'
    h.sync('你世')
    expect(h.remote()).toBe('你世')
    expect(h.wire).toEqual(['你好', '\x7f', '世'])
  })

  it('does not send text xterm wrote into the textarea on right-click', () => {
    const h = harness()
    h.value = 'selected output'
    h.mirror.adopt('selected output')
    h.value = 'selected output新'
    h.xterm('新')
    h.sync('selected output新')
    expect(h.remote()).toBe('新')
  })

  it('forgets the line after Ctrl+C', () => {
    const h = harness()
    h.value = '输到一半'
    h.xterm('输到一半')
    h.xterm('\x03', { eventType: 'keydown' })
    h.value = '新命令'
    h.xterm('新命令')
    h.value = '新命令补'
    h.sync('新命令补')
    expect(h.wire).not.toContain('新命令补')
  })

  it('does not swallow a sentence that shares the previous ending', () => {
    const h = harness()
    h.value = '。'
    h.xterm('。')
    // A keystroke ends the dictation run, so the next sentence is not a
    // correction of the previous one.
    h.xterm('\r', { eventType: 'keydown' })
    h.value = '第二句。'
    h.sync('第二句。')
    expect(h.remote()).toBe('第二句。')
  })

  it('appends a second dictation after the run was closed by typing', () => {
    const h = harness()
    h.value = '检查一下磁盘'
    h.sync('检查一下磁盘')
    h.value = '检查一下磁盘 '
    h.xterm(' ', { eventType: 'keydown' })
    h.value = '重启服务'
    h.sync('重启服务')
    expect(h.remote()).toBe('检查一下磁盘 重启服务')
  })

  it('replaces each intermediate draft a voice IME posts', () => {
    // Real report: saying "对的，谢谢你" produced "对对对，谢谢你" because every
    // intermediate draft ("对", "对对") was appended to the previous one.
    const h = harness()
    for (const text of ['对', '对对', '对的，谢谢你']) {
      h.value = text
      h.sync(text)
    }
    expect(h.remote()).toBe('对的，谢谢你')
  })

  it('never erases pasted text when a correction follows', () => {
    const h = harness()
    h.value = 'npm run build'
    h.xterm('npm run build', { eventType: 'paste' })
    h.value = 'npm run test'
    h.sync('npm run test')
    // The paste is not a dictation draft; it must survive.
    expect(h.remote()).toBe('npm run buildnpm run test')
  })

  it('removes one character per backspace even for a surrogate pair', () => {
    const h = harness()
    h.value = '你好😀'
    h.xterm('你好😀')
    h.value = '你好'
    h.xterm('\x7f', { eventType: 'keydown' })
    h.value = '你好世界'
    h.sync('你好世界')
    // A stray DEL here would eat a character that belongs to the user.
    expect(h.remote()).toBe('你好世界')
  })

  it('keeps the tracked line bounded during a very long line', () => {
    const h = harness()
    const chunk = '字'.repeat(1000)
    for (let i = 0; i < 20; i++) {
      h.value = chunk
      h.xterm(chunk)
    }
    h.value = '尾巴'
    h.sync('尾巴')
    expect(h.remote().endsWith('尾巴')).toBe(true)
  })

  it('ignores a timer-driven reply instead of treating it as an edit', () => {
    const h = harness()
    h.value = '草稿'
    h.xterm('\x1b[5;10R', { eventType: undefined, settled: '' })
    h.value = '草稿完成'
    h.xterm('草稿完成')
    expect(h.remote()).toBe('草稿完成')
  })

  it('keeps a long dictation one chunk at a time', () => {
    const h = harness()
    let line = ''
    for (let i = 0; i < 200; i++) {
      line += '字'
      h.value = '字'
      h.xterm('字')
    }
    expect(h.remote()).toBe(line)
    expect(h.wire.every((s) => s === '字')).toBe(true)
  })

  // ---- voice IME corrections: the draft is REPLACED, not appended ----

  it('replaces a voice draft the IME rewrote', () => {
    // Real report, screenshot 1.
    const h = harness()
    h.value = '杀青的时候四 g 卡片页有时候会位移修'
    h.sync(h.value)
    expect(h.remote()).toBe('杀青的时候四 g 卡片页有时候会位移修')

    h.value = '刷新的时候，4G卡片页有时候会位移，修复一下。'
    h.sync(h.value)
    // Before the fix this was draft + final on one line.
    expect(h.remote()).toBe('刷新的时候，4G卡片页有时候会位移，修复一下。')
  })

  it('replaces a draft that was committed through onData', () => {
    // Same failure, but xterm emitted the draft before the correction arrived.
    const h = harness()
    const draft = '刷新的时候四 g 卡片页会位移偶尔会位移的问题检查修复'
    h.value = draft
    h.xterm(draft)
    h.value = '刷新的时候，4G卡片页会位移。偶尔位移的问题，检查修复一下。'
    h.sync('刷新的时候，4G卡片页会位移。偶尔位移的问题，检查修复一下。')
    expect(h.remote()).toBe('刷新的时候，4G卡片页会位移。偶尔位移的问题，检查修复一下。')
  })

  it('handles repeated corrections of the same draft', () => {
    const h = harness()
    for (const text of ['你好世界这是草稿', '你好世界这是最终的句子', '你好世界，这是最终句。']) {
      h.value = text
      h.sync(text)
    }
    expect(h.remote()).toBe('你好世界，这是最终句。')
  })

  it('never erases hand-typed text when a correction follows', () => {
    const h = harness()
    h.value = 'ls /var/log'
    for (const ch of 'ls /var/log') h.xterm(ch, { eventType: 'keydown' })
    // A new dictation run starts after keyboard input.
    h.value = '看看最近的错误'
    h.sync('看看最近的错误')
    h.value = '看看最近的报错'
    h.sync('看看最近的报错')
    expect(h.remote()).toBe('ls /var/log看看最近的报错')
  })

  it('appends when the IME extends the same draft', () => {
    const h = harness()
    h.value = '默认把 API key'
    h.sync('默认把 API key')
    h.value = '默认把 API key 写进去'
    h.sync('默认把 API key 写进去')
    expect(h.remote()).toBe('默认把 API key 写进去')
  })
})
