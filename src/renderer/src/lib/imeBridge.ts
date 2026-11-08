import type { Terminal } from '@xterm/xterm'
import { createImeMirror, isImeText, isPlainText } from './imeSync'

/**
 * Connects xterm's hidden textarea to the IME mirror (see imeSync.ts) and
 * returns nothing: everything that must reach the remote goes through `send`.
 *
 * Lives outside TerminalView so the exact same wiring can be driven by real
 * Chromium IME events in a test page — the previous harness replayed an
 * assumed event order, which is how six fixes passed their tests and still
 * failed on a real machine.
 */

const DEL = '\x7f'
const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

/** Shows control characters so a trace line is readable ("\x7f", not an invisible byte). */
const vis = (s: string | null | undefined): string | null | undefined =>
  typeof s === 'string'
    ? s.replace(/[\x00-\x1f\x7f]/g, (c) =>
        c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')
      )
    : s

/**
 * A multi-line IME commit (a tidied-up dictation) must not reach a shell as raw
 * LF: that is Enter, so every line would execute. When the application has
 * switched bracketed paste on, deliver the text as a paste — erase part first,
 * outside the markers — so it is inserted, not run.
 */
function bracketMultiline(out: string, bracketed: boolean): string {
  if (!bracketed || !out.includes('\n')) return out
  const m = /^(\x7f*)([\s\S]*)$/.exec(out)
  if (!m || !/[^\x00-\x1f\x7f]/.test(m[2])) return out // a bare line break is a key
  return m[1] + BRACKETED_PASTE_START + m[2] + BRACKETED_PASTE_END
}

export function attachImeBridge(
  term: Terminal,
  rawSend: (data: string) => void,
  signal: AbortSignal
): void {
  const ta = term.textarea
  const ime = createImeMirror()

  // An older build advertised `localStorage['xssh.imeMirror'] = '0'` as an
  // A/B switch. It silently turns every de-duplication rule off, so a stale
  // value makes every voice correction duplicate and no fix can take effect.
  // Nobody should still be relying on it: drop it.
  try {
    if (window.localStorage.getItem('xssh.imeMirror') !== null) {
      window.localStorage.removeItem('xssh.imeMirror')
      console.info('[ime] removed stale localStorage xssh.imeMirror (it disabled voice de-duplication)')
    }
  } catch {
    /* storage unavailable */
  }

  // ---- Diagnostic trace (off unless main says so) -------------------------
  // Every IME-relevant DOM event, what xterm reported, what the mirror decided
  // and what went on the wire, in order. Main decides whether tracing is on
  // (see main/imeTrace.ts); it is asked once here, and while it is off nothing
  // is built or sent. Typed keys are never recorded: single-key payloads are
  // redacted so a password typed while tracing is on does not reach the log.
  let tracing = false
  const diag = window.api?.ime
  void diag
    ?.traceEnabled()
    .then((on) => {
      tracing = on
    })
    .catch(() => undefined)
  const t0 = performance.now()
  const trace = (kind: string, info: () => Record<string, unknown> = () => ({})): void => {
    if (!tracing || !diag) return
    try {
      const snap = ta ? { ta: vis(ta.value), sel: [ta.selectionStart, ta.selectionEnd] } : {}
      diag.trace(JSON.stringify({ t: Math.round(performance.now() - t0), kind, ...info(), ...snap }))
    } catch {
      /* diagnostics only */
    }
  }
  /** What to show of a payload: nothing for typed keys and terminal reports. */
  const shown = (data: string, eventType: string | undefined): string | null | undefined => {
    if (data.startsWith('\x1b')) return '(esc)'
    if ((eventType === 'keydown' || eventType === 'keypress') && data.length <= 2 && data !== DEL) return '(key)'
    return vis(data)
  }

  const send = (data: string, eventType?: string): void => {
    trace('SEND', () => ({ data: shown(data, eventType), dels: (data.match(/\x7f/g) ?? []).length }))
    rawSend(data)
  }
  /** IME output: multi-line text goes out as a bracketed paste when the app wants that. */
  const sendIme = (out: string): void => send(bracketMultiline(out, term.modes.bracketedPasteMode))

  // Anything emitted while the app pastes (term.paste) is a paste, whatever DOM
  // event — or none, after an awaited confirm dialog — happens to be current.
  // Otherwise a multi-line paste is mistaken for a dictation commit, may match
  // the recorded draft, and erase it.
  let pasting = false
  const nativePaste = term.paste.bind(term)
  term.paste = (text: string): void => {
    pasting = true
    try {
      nativePaste(text)
    } finally {
      pasting = false
    }
  }

  let composing = false
  let compStart = 0
  /** A commit whose deferred flush was skipped because the next composition
   *  started within the same tick — sent before that new draft is mirrored. */
  let pendingCommit: string | null = null
  /** A keystroke's own character was just sent; its input event (if the
   *  browser still inserts it) must not be sent a second time. */
  let keyTextSent = false

  if (ta) {
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend'] as const) {
      ta.addEventListener(type, (e) => trace(type, () => ({ data: vis((e as CompositionEvent).data) })), {
        capture: true,
        signal
      })
    }
    for (const type of ['beforeinput', 'input'] as const) {
      ta.addEventListener(
        type,
        (e) => {
          const ie = e as InputEvent
          trace(type, () => ({ inputType: ie.inputType, data: vis(ie.data), composing: ie.isComposing }))
        },
        { capture: true, signal }
      )
    }
    ta.addEventListener(
      'keydown',
      (e) => {
        // Plain keys are not interesting; IME-driven ones (keyCode 229 / "Process")
        // and anything while composing are — their `key` is a name, never a letter.
        if (e.keyCode === 229 || e.key === 'Process' || e.isComposing || e.keyCode === 252) {
          trace('keydown', () => ({ key: e.key, code: e.code, keyCode: e.keyCode, composing: e.isComposing }))
        }
      },
      { capture: true, signal }
    )

    const flushCommit = (snapshot: string): void => {
      const out = ime.sync(snapshot)
      trace('flush', () => ({ snapshot: vis(snapshot), out: vis(out) }))
      if (out) sendIme(out)
    }
    ta.addEventListener('compositionstart', () => {
      composing = true
      // A reconversion starts at the replaced range, not at the end.
      compStart = ta.selectionStart ?? ta.value.length
      // The textarea already holds the new draft, so the previous commit's
      // deferred flush would see `composing === true` and be dropped. Send it
      // against the snapshot taken at its own compositionend instead.
      if (pendingCommit !== null) {
        const snapshot = pendingCommit
        pendingCommit = null
        flushCommit(snapshot)
      }
    }, { signal })
    // Catch up after each commit in case xterm emitted nothing for it (see
    // ImeMirror.sync). Deferred so xterm's own timer-based send runs first;
    // whatever it mirrors makes this a no-op.
    ta.addEventListener('compositionend', () => {
      composing = false
      const snapshot = ta.value
      setTimeout(() => {
        if (signal.aborted) return
        if (composing) {
          // A new composition began before this timer ran. Keep the committed
          // text for compositionstart to flush: dropping it lost every commit
          // that happened to be followed by another one in the same tick.
          pendingCommit = snapshot
          return
        }
        flushCommit(snapshot)
      }, 0)
    }, { signal })
    // Same for text committed without a composition (voice input). xterm's
    // capture listener has already handled — or silently dropped — it.
    ta.addEventListener('input', (e) => {
      const kind = (e as InputEvent).inputType ?? ''
      if (composing || kind === 'insertCompositionText') return
      if (
        (kind === 'insertText' || kind === 'insertReplacementText' || kind === 'insertFromComposition') &&
        !keyTextSent
      ) {
        const out = ime.sync(ta.value)
        trace('input-sync', () => ({ out: vis(out) }))
        if (out) sendIme(out)
        return
      }
      // An IME deletion shrinks the textarea. Record the new value but keep
      // the dictation draft: an IME that rewrites by deleting and then
      // re-inserting must still be recognised as correcting that draft
      // (clearing it here turned every such correction into an append).
      if (kind.startsWith('delete')) {
        ime.track(ta.value)
        trace('track')
        return
      }
      // Anything else lands text xterm already sent or that isn't typing at
      // all: a native paste (xterm sends it, empties the textarea, then the
      // browser inserts it anyway), a drop, an undo, a keystroke's own
      // character. Account for it without sending it again.
      ime.adopt(ta.value)
      trace('adopt')
    }, { signal })
    // Every time xterm itself rewrites the textarea — emptying it on Enter,
    // Ctrl+C, blur and after a paste, or filling it with the selection on
    // right-click — that text is not something the IME typed. Catch all of
    // them at the one place they share (the value setter; IME edits never go
    // through it) instead of listing xterm's code paths one by one.
    const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    if (native?.get && native.set) {
      const { get, set } = native
      Object.defineProperty(ta, 'value', {
        configurable: true,
        get(this: HTMLTextAreaElement) {
          return get.call(this)
        },
        set(this: HTMLTextAreaElement, v: string) {
          set.call(this, v)
          if (v === '') {
            // xterm emptied the box: the textarea no longer holds the draft.
            ime.clear()
            trace('clear')
          } else if (!composing) {
            // During a composition the textarea holds the IME's *draft*, which
            // is not the remote line. Only a real write of text (right-click
            // copy, paste) should be recorded.
            ime.adopt(get.call(this))
            trace('adopt')
          }
        }
      })
    }
  }

  term.onData((data) => {
    if (!ta) {
      send(data)
      return
    }
    const eventType = pasting ? 'paste' : (window.event as Event | undefined)?.type
    // A non-IME key during composition makes xterm finish it on the spot,
    // so the whole textarea counts as settled then.
    const settled = composing && eventType !== 'keydown' ? ta.value.slice(0, compStart) : ta.value
    const out = ime.input(data, { settled, eventType })
    trace('onData', () => ({
      data: shown(data, eventType),
      eventType: eventType ?? '(timer)',
      settled: data.startsWith('\x1b') ? '(esc)' : vis(settled),
      out: shown(out, eventType)
    }))
    const fromKey = eventType === 'keydown' || eventType === 'keypress'
    if (fromKey && isPlainText(data)) {
      // The browser inserts a key's character (if at all) within the same
      // task, so this only covers that key.
      keyTextSent = true
      setTimeout(() => { keyTextSent = false }, 0)
    }
    if (!out) return
    // Only a genuine IME commit may be rewritten into a bracketed paste.
    if (!fromKey && eventType !== 'paste' && eventType !== 'drop' && isImeText(data)) sendIme(out)
    else send(out, eventType)
  })
}
