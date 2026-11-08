import type { Terminal } from '@xterm/xterm'
import { createImeMirror, isPlainText } from './imeSync'

/**
 * Connects xterm's hidden textarea to the IME mirror (see imeSync.ts) and
 * returns nothing: everything that must reach the remote goes through `send`.
 *
 * Lives outside TerminalView so the exact same wiring can be driven by real
 * Chromium IME events in a test page — the previous harness replayed an
 * assumed event order, which is how six fixes passed their tests and still
 * failed on a real machine.
 */
export function attachImeBridge(
  term: Terminal,
  send: (data: string) => void,
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

  let composing = false
  let compStart = 0
  /** A commit whose deferred flush was skipped because the next composition
   *  started within the same tick — sent before that new draft is mirrored. */
  let pendingCommit: string | null = null
  /** A keystroke's own character was just sent; its input event (if the
   *  browser still inserts it) must not be sent a second time. */
  let keyTextSent = false

  if (ta) {
    const flushCommit = (snapshot: string): void => {
      const out = ime.sync(snapshot)
      if (out) send(out)
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
        if (out) send(out)
        return
      }
      // An IME deletion shrinks the textarea. Record the new value but keep
      // the dictation draft: an IME that rewrites by deleting and then
      // re-inserting must still be recognised as correcting that draft
      // (clearing it here turned every such correction into an append).
      if (kind.startsWith('delete')) {
        ime.track(ta.value)
        return
      }
      // Anything else lands text xterm already sent or that isn't typing at
      // all: a native paste (xterm sends it, empties the textarea, then the
      // browser inserts it anyway), a drop, an undo, a keystroke's own
      // character. Account for it without sending it again.
      ime.adopt(ta.value)
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
          } else if (!composing) {
            // During a composition the textarea holds the IME's *draft*, which
            // is not the remote line. Only a real write of text (right-click
            // copy, paste) should be recorded.
            ime.adopt(get.call(this))
          }
        }
      })
    }
  }

  term.onData((data) => {
    let out = data
    if (ta) {
      const eventType = (window.event as Event | undefined)?.type
      // A non-IME key during composition makes xterm finish it on the spot,
      // so the whole textarea counts as settled then.
      const settled = composing && eventType !== 'keydown' ? ta.value.slice(0, compStart) : ta.value
      out = ime.input(data, { settled, eventType })
      if ((eventType === 'keydown' || eventType === 'keypress') && isPlainText(data)) {
        // The browser inserts a key's character (if at all) within the same
        // task, so this only covers that key.
        keyTextSent = true
        setTimeout(() => { keyTextSent = false }, 0)
      }
    }
    if (out) send(out)
  })
}
