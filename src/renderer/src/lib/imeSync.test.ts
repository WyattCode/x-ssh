import { describe, it, expect } from 'vitest'
import { createImeMirror, isImeText, movesCursor } from './imeSync'

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
        // A terminal consumes every escape sequence (CSI, OSC, ESC+char such as
        // SS3 arrow keys, legacy mouse reports); none of them becomes line text.
        const s = raw.replace(
          /\x1b\[M[\s\S]{3}|\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bO[\s\S]|\x1b[\s\S]/g,
          ''
        )
        for (const ch of Array.from(s)) {
          if (ch === '\x7f') line.pop()
          else if (ch === '\r') line = []
          else if (ch >= ' ' || ch === '\n') line.push(ch)
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
    // xterm cancels a plain key, so the textarea stays empty.
    expect(m.input('a', { settled: '', eventType: 'keydown' })).toBe('a')
    expect(m.input('hello', { settled: 'hello', eventType: 'input' })).toBe('hello')

    const h = harness()
    h.xterm('a', { eventType: 'keydown' })
    h.xterm('b', { eventType: 'keydown' })
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
    h.xterm(' ', { eventType: 'keydown' }) // the textarea is untouched by a typed key
    h.value = '检查一下磁盘重启服务'
    h.sync('检查一下磁盘重启服务')
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
    for (const ch of 'ls /var/log') h.xterm(ch, { eventType: 'keydown', settled: '' })
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

describe('createImeMirror with a tidied-up (multi-line) dictation', () => {
  // Doubao "智能文字整理": a model restructures the draft into lines and lists.
  const V1 = '你好啊，我有三个想法，第一呢吃个饭，第二呢吃冰棍，第三呢再吃'
  const V2 = '你好啊，我有三个想法：\n1. 吃个饭。\n2. 吃冰棍。\n3. 再吃个饭。'

  it('replaces the draft with the restructured text instead of stacking both', () => {
    // Real report: V1 stayed on the line and V2 (with its line breaks) was
    // appended, because a payload containing a line break was treated as a
    // control key.
    const h = harness()
    h.value = V1
    h.xterm(V1)
    h.value = V1 + V2
    h.xterm(V2)
    h.sync(V1 + V2)
    expect(h.remote()).toBe(V2)
  })

  it('replaces it when the IME edits the textarea in place', () => {
    const h = harness()
    h.value = V1
    h.xterm(V1)
    h.value = V2
    h.xterm(V2)
    h.sync(V2)
    expect(h.remote()).toBe(V2)
  })

  it('does not re-apply the later lines of one multi-line insertion', () => {
    // Chromium writes the whole text into the textarea at once, then fires one
    // input event per line; xterm reports each line as its own payload while the
    // textarea already holds everything. Real trace: the 2nd line used to be
    // treated as new text and cost 27 backspaces plus a stray copy.
    const h = harness()
    h.value = V1
    h.xterm(V1)
    h.value = V1 + V2
    const lines = V2.split('\n')
    h.xterm(lines[0])
    for (const line of lines.slice(1)) h.xterm(line)
    h.sync(V1 + V2)
    expect(h.remote()).toBe(V2)
    expect(h.wire.join('').match(/\x7f/g)?.length).toBe(Array.from(V1).length - Array.from('你好啊，我有三个想法').length)
  })

  it('still sends a bare Enter as a key', () => {
    const h = harness()
    expect(h.mirror.input('\r', { settled: '', eventType: 'keydown' })).toBe('\r')
    expect(h.mirror.input('\r', { settled: '', eventType: undefined })).toBe('\r')
  })
})

describe('createImeMirror with the real Doubao flow', () => {
  // Device trace: a fake key (keyCode 252) mid-dictation makes xterm finish the
  // composition and send the UNTIDIED draft as eventType 'keydown'; later the
  // tidied text replaces it in the textarea and arrives from a timer.
  const DRAFT = '今天我要吃个饭，第一我要吃米饭，第二，我要吃土豆，第三我要吃水饺，第四我要吃番茄，第五我要吃'
  const TIDY = '今天我要吃个饭：\n1. 米饭\n2. 土豆\n3. 水饺\n4. 番茄\n5. 猪肉'

  it('erases a draft that went out as keydown text when the tidy-up replaces it', () => {
    // Without a line-based erase check this was "append the new tail, keep the old
    // one": the keydown path ends the dictation run, so the draft looked hand-typed.
    const h = harness()
    h.value = DRAFT
    h.xterm(DRAFT, { eventType: 'keydown' })
    h.value = TIDY
    h.xterm(TIDY, { eventType: undefined })
    h.sync(TIDY) // compositionend catch-up
    expect(h.remote()).toBe(TIDY)
    const dels = h.wire.join('').match(/\x7f/g)?.length
    expect(dels).toBe(Array.from(DRAFT).length - Array.from('今天我要吃个饭').length)
  })

  it('still erases it after mouse and focus reports arrived in between', () => {
    // A TUI with mouse tracking reports every pointer move through onData. Their
    // printable tails ("[<35;12;5M") used to be recorded as line text, so the
    // line no longer ended with the draft and the correction was only appended.
    const h = harness()
    h.value = DRAFT
    h.xterm(DRAFT, { eventType: 'keydown' })
    for (const report of ['\x1b[<35;12;5M', '\x1b[<35;13;6M', '\x1b[I', '\x1b[12;40R', '\x1b]10;rgb:e6e6/e8e8/ecec\x1b\\'])
      h.xterm(report, { eventType: 'mousemove' })
    h.value = TIDY
    h.xterm(TIDY, { eventType: undefined })
    expect(h.remote()).toBe(TIDY)
  })

  it('does not record arrow keys as text, and does not end the run for them', () => {
    const h = harness()
    h.value = V1x
    h.xterm(V1x)
    h.xterm('\x1b[A', { eventType: 'keydown' })
    h.xterm('\x1bOD', { eventType: 'keydown' })
    h.value = V1x + '补充一句'
    h.xterm('补充一句')
    expect(h.remote()).toBe(V1x + '补充一句')
  })
})

const V1x = '把日志目录清理一下'

describe('createImeMirror telling dictation from paste', () => {
  it('never takes a multi-line paste for dictation (CR is a paste, LF is dictation)', () => {
    expect(isImeText('第一行\n第二行')).toBe(true)
    expect(isImeText('第一行\r第二行')).toBe(false)
    expect(isImeText('\x1b[<35;1;1M')).toBe(false)
    expect(isImeText('\r')).toBe(false)
  })

  it('does not let a pasted line that resembles the draft erase the draft', () => {
    const h = harness()
    h.value = '你好世界这是草稿'
    h.xterm('你好世界这是草稿')
    // The app's own paste arrives with eventType 'paste' (the bridge forces it).
    h.xterm('你好世界这是粘贴', { eventType: 'paste' })
    expect(h.remote()).toBe('你好世界这是草稿你好世界这是粘贴')
    expect(h.wire.join('')).not.toContain('\x7f')
  })

  it('ends the line for a paste that carries a line break, so nothing later erases across it', () => {
    const h = harness()
    h.value = '先说一句话'
    h.xterm('先说一句话')
    h.xterm('echo a\recho b', { eventType: 'paste' })
    h.value = '先说一句话新的内容'
    h.sync('先说一句话新的内容')
    expect(h.wire.join('')).not.toContain('\x7f')
  })
})

describe('createImeMirror erasing a replaced tail', () => {
  it('erases the draft that a keydown forced out when the IME later replaces it', () => {
    // Real report: the front of the line survived, the old tail stayed, and the
    // new tail was appended after it. The forced draft is the dictation run.
    const h = harness()
    const V1 = '你好啊，现在说话你会觉得我会可能产生重复吗'
    const V2 = '你好啊，现在说话，你会觉得我会可能产生重复吗？'
    h.value = V1
    h.xterm(V1, { eventType: 'keydown' }) // xterm finished the composition on a fake key
    h.value = V2
    h.sync(V2)
    expect(h.remote()).toBe(V2)
  })

  it('does not erase across text that was pasted after the draft', () => {
    const h = harness()
    h.value = '你好世界这是草稿'
    h.xterm('你好世界这是草稿')
    h.xterm('粘贴内容', { eventType: 'paste' })
    h.value = '你好世界这是定稿'
    h.sync('你好世界这是定稿')
    expect(h.wire.join('')).not.toContain('\x7f')
  })

  it('does not erase typed text that merely looks like the end of the old draft', () => {
    // The draft ends with "。"; the user types "。" by hand; the IME then edits
    // its own trailing "。". The typed one is at the end of the line, but it is
    // not part of the dictation, so it must not be what gets erased.
    const h = harness()
    h.value = '今天吃饭。'
    h.xterm('今天吃饭。')
    h.xterm('。', { eventType: 'keydown' })
    h.value = '今天吃饭！'
    h.sync('今天吃饭！')
    expect(h.wire.join('')).not.toContain('\x7f')
  })

  it('records a tab in IME text so a later correction can still erase across it', () => {
    const h = harness()
    const V1 = '前缀文字草稿\t结尾'
    const V2 = '前缀文字最终\t结尾'
    h.value = V1
    h.xterm(V1)
    h.value = V2
    h.sync(V2)
    // removed = "草稿\t结尾": 5 characters.
    expect(h.wire.join('').match(/\x7f/g)?.length).toBe(5)
  })
})

describe('createImeMirror after the cursor moved or the line was edited', () => {
  const V1 = '你好，我今天希望吃饭，吃了饭之后再吃，首先其一'
  const V2 = '你好，我今天希望吃饭，吃了饭之后再吃。首先，其一。'
  const edits: Array<[string, string]> = [
    ['Left (CSI)', '\x1b[D'],
    ['Right with modifier', '\x1b[1;5C'],
    ['Home (SS3)', '\x1bOH'],
    ['End (CSI ~)', '\x1b[4~'],
    ['Delete', '\x1b[3~'],
    ['Up (history)', '\x1b[A'],
    ['Alt+Backspace', '\x1b\x7f'],
    ['Alt+b', '\x1bb'],
    ['Ctrl+A', '\x01'],
    ['Ctrl+E', '\x05'],
    ['Ctrl+W', '\x17'],
    ['Ctrl+K', '\x0b'],
    ['Tab completion', '\t']
  ]
  for (const [name, bytes] of edits) {
    it(`appends instead of erasing after ${name}`, () => {
      // Erasing "the last N characters" would hit the wrong text now.
      const h = harness()
      h.value = V1
      h.xterm(V1)
      h.xterm(bytes, { eventType: 'keydown' })
      h.value = V2
      h.sync(V2)
      // wire = [draft, the key itself, correction]; the key may contain DEL (Alt+Backspace).
      expect(h.wire.slice(2).join('')).not.toContain('\x7f')
    })
  }

  const harmless: Array<[string, string]> = [
    ['SGR mouse report', '\x1b[<35;12;5M'],
    ['legacy mouse report', '\x1b[M #!'],
    ['focus in', '\x1b[I'],
    ['focus out', '\x1b[O'],
    ['cursor position reply', '\x1b[12;40R'],
    ['device attributes reply', '\x1b[?1;2c'],
    ['OSC colour reply', '\x1b]10;rgb:e6e6/e8e8/ecec\x1b\\']
  ]
  for (const [name, bytes] of harmless) {
    it(`still erases after a ${name}`, () => {
      const h = harness()
      h.value = V1
      h.xterm(V1)
      h.xterm(bytes, { eventType: 'mousemove' })
      h.value = V2
      h.sync(V2)
      expect(h.remote()).toBe(V2)
    })
  }

  it('trusts the line again once Enter empties it', () => {
    const h = harness()
    h.value = V1
    h.xterm(V1)
    h.xterm('\x1b[D', { eventType: 'keydown' })
    h.xterm('\r', { eventType: 'keydown' })
    h.mirror.clear() // xterm empties the textarea on Enter
    h.value = V1
    h.xterm(V1)
    h.value = V2
    h.sync(V2)
    expect(h.remote()).toBe(V2)
  })
})

describe('movesCursor', () => {
  it('separates cursor/editing sequences from terminal reports', () => {
    for (const s of ['\x1b[A', '\x1b[1;2B', '\x1b[C', '\x1b[D', '\x1b[H', '\x1b[F', '\x1b[Z', '\x1b[3~', '\x1bOA', '\x1bOD', '\x1bb', '\x1b\x7f'])
      expect(movesCursor(s), JSON.stringify(s)).toBe(true)
    for (const s of ['\x1b[<0;1;1M', '\x1b[<35;12;5m', '\x1b[M !!', '\x1b[I', '\x1b[O', '\x1b[1;1R', '\x1b[?62c', '\x1b[200~', '\x1b[201~', '\x1b]11;rgb:0e0e/0f0f/1212\x07', '\x1bOP'])
      expect(movesCursor(s), JSON.stringify(s)).toBe(false)
  })
})
