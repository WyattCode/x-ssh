import { describe, it, expect } from 'vitest'
import { createImeMirror } from './imeSync'

/**
 * Replays the real chain: `xterm()` is `term.onData`, which has ALREADY put the
 * payload on the wire when it fires; `sync()` is the DOM input / compositionend
 * catch-up. Everything either path sends is replayed through a minimal line
 * editor standing in for the remote.
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
    /** xterm's onData: xterm itself sends `data`, then the mirror may add. */
    xterm(data: string, opts: { eventType?: string; settled?: string } = {}): void {
      push(data)
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
  it('never re-sends text xterm already emitted', () => {
    // The whole point: `onData` means "already on the wire". Returning anything
    // for plain text is the duplicated dictation users reported.
    const m = createImeMirror()
    expect(m.input('你好', { settled: '你好', eventType: 'input' })).toBe('')
    expect(m.input('任意文本', { settled: '', eventType: undefined })).toBe('')
  })

  it('commits a sentence exactly once', () => {
    const h = harness()
    h.value = '你好'
    h.xterm('你好')
    expect(h.wire).toEqual(['你好'])
    expect(h.remote()).toBe('你好')
  })

  it('does not duplicate consecutive dictated sentences', () => {
    const h = harness()
    h.value = '第一句。'
    h.xterm('第一句。')
    // xterm empties the textarea after each commit; the next sentence is all
    // the box holds.
    h.value = '第二句。'
    h.xterm('第二句。')
    expect(h.remote()).toBe('第一句。第二句。')
  })

  it('does not send the commit again when its input event follows', () => {
    // A composition produces both onData and an input event for the same text.
    // The catch-up seeing it a second time is the duplicate that survived the
    // earlier "reconcile the textarea" design.
    const h = harness()
    h.value = '我排查一下'
    h.xterm('我排查一下')
    h.sync('我排查一下')
    expect(h.remote()).toBe('我排查一下')
  })

  it('sends text xterm dropped for the current commit', () => {
    const h = harness()
    h.value = '接着说'
    h.sync()
    expect(h.remote()).toBe('接着说')
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
    h.xterm('\x7f', { eventType: 'keydown' })
    h.value = '你好世'
    h.sync('你好世')
    expect(h.remote()).toBe('你好世')
  })

  it('does not send text xterm wrote into the textarea on right-click', () => {
    const h = harness()
    h.value = 'selected output'
    h.mirror.adopt('selected output')
    h.value = 'selected output新'
    h.xterm('新')
    // The input event that follows must not resend the selection or the char.
    h.sync('selected output新')
    expect(h.remote()).toBe('新')
  })

  it('forgets the line after Ctrl+C, so the next commit is not resent in full', () => {
    const h = harness()
    h.value = '输到一半'
    h.xterm('输到一半')
    h.xterm('\x03', { eventType: 'keydown' }) // readline discards the buffer
    h.value = '新命令'
    h.xterm('新命令')
    h.value = '新命令补'
    h.sync('新命令补')
    // With the line forgotten, the catch-up only adds the new tail.
    expect(h.wire).not.toContain('新命令补')
  })

  it('does not swallow a sentence because the last payload ended the same way', () => {
    const h = harness()
    h.value = '。'
    h.xterm('。')
    // xterm emitted nothing for this one; it merely shares the punctuation.
    h.value = '第二句。'
    h.sync('第二句。')
    expect(h.remote()).toBe('。第二句。')
  })

  it('keeps the tracked line bounded during a very long line', () => {
    const h = harness()
    const chunk = '字'.repeat(1000)
    for (let i = 0; i < 20; i++) {
      h.value = chunk
      h.xterm(chunk)
    }
    // 20k characters typed into one line; the record must not grow forever.
    h.value = '尾巴'
    h.sync('尾巴')
    expect(h.remote().endsWith('尾巴')).toBe(true)
  })

  it('passes control sequences through unchanged', () => {
    const h = harness()
    h.xterm('\x1b[A', { eventType: 'keydown' })
    h.xterm('\x03', { eventType: 'keydown' })
    expect(h.wire).toEqual(['\x1b[A', '\x03'])
  })

  it('ignores a timer-driven reply instead of treating it as an edit', () => {
    // Cursor-position replies arrive from a timer, not a key press.
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
})
