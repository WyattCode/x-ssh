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
    // xterm never empties its textarea between commits: it accumulates.
    h.value = '第一句。'
    h.xterm('第一句。')
    h.sync('第一句。')
    h.value = '第一句。第二句。'
    h.xterm('第二句。')
    h.sync('第一句。第二句。')
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
    // xterm empties the textarea after a paste.
    h.mirror.clear()
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

  it('replaces the previous draft when the IME re-reads the audio', () => {
    // Real report, screenshot 3: Doubao/WeChat re-read the whole sentence and
    // post it again through onData. Both versions ended up on the line because
    // the correction path only existed for the textarea catch-up.
    const h = harness()
    const draft = '二次审查代码检查 ui 细节检查'
    const final = '审查代码二次审查代码，检查UI细节，检查Bug。'
    h.value = draft
    h.xterm(draft)
    h.value = final
    h.xterm(final)
    expect(h.remote()).toBe(final)
  })

  it('sends only the new tail when the IME extends what it already sent', () => {
    const h = harness()
    h.value = '把日志'
    h.xterm('把日志')
    h.value = '把日志清理一下'
    h.xterm('把日志清理一下')
    expect(h.remote()).toBe('把日志清理一下')
    expect(h.wire).toEqual(['把日志', '清理一下'])
  })

  it('appends when two dictations share no phrase', () => {
    const h = harness()
    h.value = '重启服务'
    h.xterm('重启服务')
    h.value = '重启服务查看磁盘'
    h.xterm('查看磁盘')
    // Nothing in common beyond a character → a new sentence, not a rewrite.
    expect(h.remote()).toBe('重启服务查看磁盘')
  })

  it('replaces a draft that only changed punctuation', () => {
    // Real report, screenshot 4 (plain shell): the second pass added a full
    // stop and a comma, which is not a prefix of the first — it was appended.
    const h = harness()
    const draft = '你好，我今天希望吃饭，吃了饭之后再吃，首先其一'
    const final = '你好，我今天希望吃饭，吃了饭之后再吃。首先，其一。'
    h.value = draft
    h.xterm(draft)
    h.value = final
    h.xterm(final)
    expect(h.remote()).toBe(final)
  })

  it('only erases the part that differs', () => {
    const h = harness()
    h.value = 'abcdef中文结尾'
    h.xterm('abcdef中文结尾')
    h.value = 'abcdef中文收尾'
    h.xterm('abcdef中文收尾')
    expect(h.remote()).toBe('abcdef中文收尾')
    // One erasure pair, not the whole sentence re-typed.
    expect(h.wire[1]).toBe('\x7f\x7f收尾')
  })

  it('does not end the dictation when an arrow key is pressed', () => {
    // TUI editing is full of arrow keys; clearing the draft on them made the
    // next voice commit look like new text.
    const h = harness()
    h.value = '第一版'
    h.xterm('第一版')
    h.xterm('\x1b[A', { eventType: 'keydown' })
    h.value = '第一版改'
    h.xterm('第一版改')
    expect(h.remote()).toBe('第一版改')
  })

  it('keeps a long dictation in step as it grows', () => {
    const h = harness()
    let line = ''
    for (let i = 0; i < 60; i++) {
      line += '字'
      // Each commit is the whole draft, one character longer than the last.
      h.value = line
      h.xterm(line)
    }
    expect(h.remote()).toBe(line)
    // Only the character that was actually new goes on the wire.
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

// The textarea is NOT the remote line: xterm leaves it alone between commits, so
// it accumulates every version a voice IME posts. These replay the sequences
// real Chromium produced (see scripts/ime-e2e) — the earlier tests above model
// a textarea that only ever holds the current draft, which is why six fixes
// passed them and still duplicated on a real machine.
describe('createImeMirror with an accumulating textarea', () => {
  const V1 = '你好，我今天希望吃饭，吃了饭之后再吃，首先其一'
  const V2 = '你好，我今天希望吃饭，吃了饭之后再吃。首先，其一。'

  it('does not undo a correction when the catch-up reports the whole textarea', () => {
    // The bug: onData(V2) rewrote V1 → V2, then the input/compositionend
    // catch-up saw the textarea "V1V2" and "corrected" the line into V1+V2.
    const h = harness()
    h.value = V1
    h.xterm(V1)
    h.sync(V1)
    h.value = V1 + V2
    h.xterm(V2)
    h.sync(V1 + V2)
    h.sync(V1 + V2) // compositionend fires too
    expect(h.remote()).toBe(V2)
  })

  it('applies a correction exactly once however many events report it', () => {
    const h = harness()
    h.value = V1
    h.sync(V1)
    h.value = V1 + V2
    h.sync(V1 + V2)
    h.sync(V1 + V2)
    h.xterm(V2) // xterm's own timer-driven report arrives last
    expect(h.remote()).toBe(V2)
  })

  it('follows an in-place edit of the textarea instead of appending', () => {
    const h = harness()
    h.value = V1
    h.xterm(V1)
    h.value = V2
    // xterm's payload for a composition that replaced text in place is an
    // arbitrary fragment of the new value; the textarea is what counts.
    h.xterm(V2.slice(V1.length - 4), { eventType: undefined })
    h.sync(V2)
    expect(h.remote()).toBe(V2)
  })

  it('keeps the draft when the IME deletes the textarea before re-inserting', () => {
    const h = harness()
    h.value = V1
    h.xterm(V1)
    h.value = ''
    h.mirror.track('') // an IME deletion must not end the dictation run
    h.value = V2
    h.xterm(V2)
    h.sync(V2)
    expect(h.remote()).toBe(V2)
  })

  it('resolves 对 / 对对 / 对的，谢谢你 when the IME edits its draft in place', () => {
    const h = harness()
    for (const text of ['对', '对对', '对的，谢谢你']) {
      h.value = text
      h.xterm(text)
      h.sync(text)
    }
    expect(h.remote()).toBe('对的，谢谢你')
  })

  it('leaves the line alone when xterm empties the textarea', () => {
    const h = harness()
    h.value = '第一句。'
    h.xterm('第一句。')
    h.mirror.clear() // Enter / blur
    h.value = '第二句。'
    h.sync('第二句。')
    expect(h.remote()).toBe('第一句。第二句。')
  })

  it('does not resend the textarea after a Ctrl+U that left it intact', () => {
    const h = harness()
    h.value = '清空这一行'
    h.xterm('清空这一行')
    h.xterm('', { eventType: 'keydown' })
    h.value = '清空这一行新的内容'
    h.sync('清空这一行新的内容')
    // (the line editor stand-in ignores Ctrl+U, so look at the wire)
    expect(h.wire).toEqual(['清空这一行', '', '新的内容'])
  })

  it('counts a surrogate pair as one character when erasing a replaced tail', () => {
    const h = harness()
    h.value = '今天天气好😀'
    h.sync('今天天气好😀')
    h.value = '今天天气好呀'
    h.sync('今天天气好呀')
    expect(h.remote()).toBe('今天天气好呀')
  })
})
