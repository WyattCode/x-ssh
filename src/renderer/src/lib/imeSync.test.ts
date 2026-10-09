import { describe, it, expect } from 'vitest'
import { createImeMirror } from './imeSync'

/**
 * Drives a mirror the way TerminalView does, and replays everything it sends
 * through a minimal line editor standing in for the remote input box.
 */
function harness() {
  const mirror = createImeMirror()
  let value = ''
  const sent: string[] = []
  const emit = (data: string, eventType: string | undefined, settled = value): void => {
    const out = mirror.input(data, { settled, eventType })
    if (out) sent.push(out)
  }
  const remote = (): string => {
    let line: string[] = []
    for (const raw of sent) {
      // Escape sequences (e.g. a cursor-position reply) never land in the line.
      const s = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      for (const ch of Array.from(s)) {
        if (ch === '\x7f') line.pop()
        else if (ch === '\r') line = []
        else if (ch >= ' ') line.push(ch)
      }
    }
    return line.join('')
  }
  return {
    mirror,
    sent,
    remote,
    emit,
    /** The IME committed text: the textarea now holds `v`, xterm emits `data`. */
    commit(v: string, data: string, eventType: string | undefined = undefined) {
      value = v
      emit(data, eventType)
    },
    set value(v: string) {
      value = v
    },
    get value() {
      return value
    }
  }
}

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number): (n: number) => number {
  let s = seed >>> 0
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s % n
  }
}
const ALPHABET = Array.from('ab你好，。😀')

describe('createImeMirror (randomised)', () => {
  it('never erases a character it did not send itself', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed)
      const mirror = createImeMirror()
      let ta = '' // xterm's textarea
      const remote: { ch: string; mine: boolean }[] = []
      const word = (): string =>
        Array.from({ length: 1 + r(4) }, () => ALPHABET[r(ALPHABET.length)]).join('')
      const apply = (out: string, mine: boolean): void => {
        // Escape sequences (a query reply) are consumed, never part of the line.
        for (const ch of Array.from(out.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''))) {
          if (ch === '\x7f') {
            const gone = remote.pop()
            if (mine && gone && !gone.mine) {
              throw new Error(`seed ${seed}: mirror erased ${JSON.stringify(gone.ch)} it never sent`)
            }
          } else {
            remote.push({ ch, mine })
          }
        }
      }
      for (let step = 0; step < 40; step++) {
        const op = r(10)
        const chars = Array.from(ta)
        if (op < 5) {
          // The IME edits committed text: append, or replace any range.
          const from = r(chars.length + 1)
          const to = from + r(chars.length - from + 1)
          ta = [...chars.slice(0, from), ...Array.from(word()), ...chars.slice(to)].join('')
          const out = r(2)
            ? mirror.input(word(), { settled: ta, eventType: r(2) ? 'input' : undefined })
            : mirror.sync(ta)
          apply(out, true)
        } else if (op === 5) {
          apply(mirror.input(word(), { settled: ta, eventType: 'keydown' }), false)
        } else if (op === 6) {
          apply(mirror.input('\x7f', { settled: ta, eventType: 'keydown' }), false)
        } else if (op === 7) {
          ta = word() // xterm writes the selection on right-click
          mirror.adopt(ta)
        } else if (op === 8) {
          ta = '' // blur / Enter / paste
          mirror.adopt(ta)
        } else {
          apply(mirror.input('\x1b[1;1R', { settled: ta, eventType: undefined }), false)
        }
      }
    }
  })

  it('keeps the remote exactly equal to the textarea under pure IME editing', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed)
      const mirror = createImeMirror()
      let ta = ''
      let line: string[] = []
      for (let step = 0; step < 30; step++) {
        const chars = Array.from(ta)
        const from = r(chars.length + 1)
        const to = from + r(chars.length - from + 1)
        const ins = Array.from({ length: r(4) }, () => ALPHABET[r(ALPHABET.length)])
        ta = [...chars.slice(0, from), ...ins, ...chars.slice(to)].join('')
        const out = r(2) ? mirror.sync(ta) : mirror.input(ins.join('') || 'x', { settled: ta, eventType: 'input' })
        for (const ch of Array.from(out)) {
          if (ch === '\x7f') line.pop()
          else line = [...line, ch]
        }
        expect(line.join(''), `seed ${seed} step ${step}`).toBe(ta)
      }
    }
  })
})

describe('createImeMirror', () => {
  it('sends an ordinary pinyin commit once', () => {
    const h = harness()
    h.commit('你', '你')
    expect(h.sent).toEqual(['你'])
  })

  it('drops the second of xterm’s two emits for the same commit', () => {
    const h = harness()
    h.commit('你好', '你好', 'input') // input-event path
    h.emit('你好', undefined) // compositionend timer path, same text
    expect(h.remote()).toBe('你好')
  })

  it('replaces a voice draft with its correction instead of appending it', () => {
    const h = harness()
    h.commit('我排查一下为什么这个', '我排查一下为什么这个')
    // The IME rewrites the committed range; xterm emits the whole correction.
    h.commit('我排查一下，为什么这个', '我排查一下，为什么这个', 'input')
    expect(h.remote()).toBe('我排查一下，为什么这个')
    // Only the changed tail was erased and resent.
    expect(h.sent[1]).toBe('\x7f'.repeat(5) + '，为什么这个')
  })

  it('handles reconversion, where xterm emits only a fragment', () => {
    const h = harness()
    h.commit('我排查一下为什么这个', '我排查一下为什么这个')
    h.commit('我排查一下，为什么这个', '个') // xterm's substring from the old length
    expect(h.remote()).toBe('我排查一下，为什么这个')
  })

  it('appends consecutive dictated sentences', () => {
    const h = harness()
    h.commit('第一句。', '第一句。', 'input')
    h.commit('第一句。第二句。', '第二句。', 'input')
    expect(h.remote()).toBe('第一句。第二句。')
  })

  it('never erases text that was dictated before a manual keystroke', () => {
    const h = harness()
    h.commit('hello', 'hello')
    h.emit('x', 'keydown') // typed on the remote, not in the textarea
    h.commit('Hello', 'Hello', 'input') // late correction of the earlier draft
    expect(h.remote().startsWith('hellox')).toBe(true)
    expect(h.sent.join('')).not.toContain('\x7f')
  })

  it('keeps the untouchable prefix protected after a change that crossed it', () => {
    const h = harness()
    // Text the remote got some other way (e.g. right-click copy), kept in the
    // textarea but never sent by the mirror.
    h.value = 'abcdef'
    h.mirror.adopt(h.value)
    h.emit('Z', 'keydown') // something on the remote after it
    // The IME rewrites inside the protected text, then rewrites its start.
    h.commit('abXdef', 'abXdef', 'input')
    h.commit('ABXdef', 'ABXdef', 'input')
    // Only what the mirror itself sent ("Xdef") may ever be erased.
    const erased = h.sent.join('').split('\x7f').length - 1
    expect(erased).toBeLessThanOrEqual('Xdef'.length)
    expect(h.remote().startsWith('Z')).toBe(true)
  })

  it('keeps correcting text dictated after a manual keystroke', () => {
    const h = harness()
    h.commit('ab', 'ab')
    h.emit('\x7f', 'keydown') // Backspace on the remote
    h.commit('ab cd', ' cd', 'input')
    h.commit('ab CD', 'ab CD', 'input')
    expect(h.remote()).toBe('a CD')
  })

  it('starts fresh after Enter', () => {
    const h = harness()
    h.commit('发送', '发送')
    h.value = '' // xterm clears the textarea on Enter before emitting \r
    h.emit('\r', 'keydown')
    h.commit('下一条', '下一条')
    expect(h.sent).toEqual(['发送', '\r', '下一条'])
  })

  it('still corrects a draft after a timer-driven reply to a terminal query', () => {
    // TUIs like opencode poll the cursor position constantly; xterm answers
    // from a timer. That reply must not freeze the draft against correction.
    const h = harness()
    h.commit('我排查一下为什么这个', '我排查一下为什么这个')
    h.emit('\x1b[5;10R', undefined)
    h.commit('我排查一下，为什么这个', '我排查一下，为什么这个', 'input')
    expect(h.remote()).toBe('我排查一下，为什么这个')
    // The correction erased the draft tail rather than being appended whole.
    expect(h.sent[2]).toBe('\x7f'.repeat(5) + '，为什么这个')
  })

  it('ignores the open composition when a reply arrives mid-composition', () => {
    const h = harness()
    h.commit('第一句', '第一句')
    h.value = '第一句第二' // composition still open; settled is just 第一句
    h.emit('\x1b[5;10R', undefined, '第一句')
    h.commit('第一句第二句', '第二句')
    expect(h.remote()).toBe('第一句第二句')
  })

  it('never sends text xterm wrote into the textarea on right-click', () => {
    const h = harness()
    h.value = 'selected output'
    h.mirror.adopt(h.value)
    // Typing over the selection replaces it.
    h.commit('新', '新', 'input')
    expect(h.sent).toEqual(['新'])
    // Or, if the selection was lost, the IME appends to it.
    const g = harness()
    g.value = 'selected output'
    g.mirror.adopt(g.value)
    g.commit('selected output新', '新', 'input')
    expect(g.sent).toEqual(['新'])
  })

  it('does not erase remote text after the textarea is emptied on blur', () => {
    const h = harness()
    h.commit('第一段', '第一段')
    h.value = ''
    h.mirror.clear()
    h.commit('第二段', '第二段')
    expect(h.remote()).toBe('第一段第二段')
  })

  it('counts an astral character as one DEL', () => {
    const h = harness()
    h.commit('好😀', '好😀')
    h.commit('好🎉', '好🎉', 'input')
    expect(h.sent[1]).toBe('\x7f🎉')
    expect(h.remote()).toBe('好🎉')
  })

  it('does not drop repeated keystrokes', () => {
    const h = harness()
    for (let i = 0; i < 3; i++) h.emit('a', 'keydown')
    expect(h.remote()).toBe('aaa')
  })

  it('sync corrects a reconversion that got shorter, which xterm emits nothing for', () => {
    const h = harness()
    h.commit('我排查一下为什么这个', '我排查一下为什么这个')
    h.value = '我排查一下为何' // xterm's substring from the old length is empty
    const out = h.mirror.sync(h.value)
    h.sent.push(out)
    expect(h.remote()).toBe('我排查一下为何')
  })

  it('sync sends voice text that xterm dropped', () => {
    const h = harness()
    h.value = '接着说' // committed, but xterm emitted nothing
    h.sent.push(h.mirror.sync(h.value))
    expect(h.remote()).toBe('接着说')
    // If xterm does emit it afterwards, it is not sent twice.
    h.emit('接着说', 'input')
    expect(h.remote()).toBe('接着说')
  })

  it('sync is a no-op once xterm’s own emit has been mirrored', () => {
    const h = harness()
    h.commit('你好', '你好')
    expect(h.mirror.sync('你好')).toBe('')
  })

  it('passes control sequences through unchanged', () => {
    const h = harness()
    h.emit('\x1b[A', 'keydown')
    h.emit('\x03', 'keydown')
    expect(h.sent).toEqual(['\x1b[A', '\x03'])
  })
})
