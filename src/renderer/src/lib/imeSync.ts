/**
 * Keeps the remote input line in step with what an IME has put into xterm's
 * hidden textarea.
 *
 * Voice input (WeChat, Windows voice typing…) commits a draft and then rewrites
 * that already-committed text with a corrected version. In a normal text box
 * that is an in-place replacement. A terminal has already sent the draft, and
 * xterm sends the correction as new input, so the remote line ends up holding
 * both. Reconversion over committed text is worse: xterm measures the new
 * composition from the old length and sends only a fragment of the result.
 *
 * So instead of trusting what xterm emits for IME text, treat the remote line
 * as a mirror of the textarea: when committed text changes, erase the part that
 * changed (one DEL per character) and send the new tail.
 */

const DEL = '\x7f'
const CONTROL = /[\x00-\x1f\x7f]/

/** Printable text only — no C0 controls, DEL or escape sequences. */
export const isPlainText = (data: string): boolean => data !== '' && !CONTROL.test(data)

export interface ImeInputContext {
  /** xterm's hidden textarea, minus any composition still in progress. */
  settled: string
  /**
   * Type of the DOM event being dispatched when xterm emitted the data
   * (`window.event`), or undefined when it came from a timer — which is how
   * xterm sends a finished composition.
   */
  eventType: string | undefined
}

export interface ImeMirror {
  /** What should actually reach the remote for one xterm `onData` payload. */
  input(data: string, ctx: ImeInputContext): string
  /**
   * What to send so the remote catches up with the settled textarea, called
   * when the IME commits (compositionend, a committed `input`). This is the
   * safety net for commits xterm emits nothing for: a reconversion that made
   * the text shorter, or voice text xterm ignores because it still believes
   * a key is held (its keyup went to a dialog). Empty if already in step.
   */
  sync(settled: string): string
  /**
   * Accept the textarea's current text as already accounted for.
   *
   * `protect` (default true) marks the whole baseline as untouchable — right for
   * text that came from outside the mirror, e.g. xterm filling the textarea
   * with terminal output on right-click copy. Pass false when the text was the
   * mirror's own and the user merely deleted part of it: keeping a backspace
   * "protected" is what made the next dictation append a duplicate instead of
   * replacing the old tail.
   */
  adopt(baseline: string, protect?: boolean): void
  /** The textarea was emptied behind our back (xterm does this on blur). */
  clear(): void
}

/** Event types during which xterm's own IME paths emit text. */
const imeEvent = (type: string | undefined): boolean =>
  type === undefined || type === 'input' || type === 'compositionend'

/** Pre-mirror behaviour, behind `localStorage['xssh.imeMirror'] = '0'`: useful
 *  for A/B diagnosis on a machine where a specific IME misbehaves. */
export function createPassthroughMirror(): ImeMirror {
  return {
    input: (data) => data,
    sync: () => '',
    adopt: () => undefined,
    clear: () => undefined
  }
}

export function createImeMirror(): ImeMirror {
  /** Textarea text already reflected on the remote (or deliberately left alone). */
  let synced = ''
  /** Leading characters of `synced` that must never be erased. */
  let floor = 0

  function adopt(baseline: string, protect = true): void {
    const len = Array.from(baseline).length
    // Only a pure tail deletion may lower the watermark. An external write (or
    // any edit that is not a strict prefix of what we mirrored) keeps — or
    // raises — the protection, so text the mirror never sent is never erased.
    const tailOnly = synced.startsWith(baseline)
    synced = baseline
    floor = protect ? len : tailOnly ? Math.min(floor, len) : len
  }

  function reconcile(next: string): string {
    const a = Array.from(synced)
    const b = Array.from(next)
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let out: string
    if (p >= floor) {
      // Erase exactly the tail we sent, then resend from the change point.
      // This is the only branch that produces correct text. It used to have a
      // size limit here (falling back to "append only"), which is precisely why
      // voice dictation duplicated words when it rewrote a long paragraph.
      out = DEL.repeat(a.length - p) + b.slice(p).join('')
    } else {
      // The change reaches into text the mirror never sent (right-click copy
      // put terminal output in the textarea). Erase only what we own.
      out = DEL.repeat(Math.max(0, a.length - floor)) + b.slice(p).join('')
      floor = p
    }
    synced = next
    return out
  }

  return {
    input(data, { settled, eventType }) {
      if (!isPlainText(data)) {
        // Keys, escape sequences, replies to terminal queries. Only something
        // the user did can move the remote line under the mirror; a reply sent
        // from a timer (e.g. to a cursor-position query mid-composition) must
        // leave it alone.
        // A backspace deletes text the mirror sent, so that tail must stay
        // erasable — protecting it is what caused duplicated dictation.
        if (eventType !== undefined) adopt(settled, data !== DEL)
        return data
      }
      if (settled !== synced) return reconcile(settled)
      // Nothing changed in the textarea: either xterm's second IME path is
      // re-emitting text already mirrored, or this is an ordinary keystroke.
      if (imeEvent(eventType)) return ''
      adopt(settled)
      return data
    },
    sync(settled) {
      return settled === synced ? '' : reconcile(settled)
    },
    adopt,
    clear() {
      synced = ''
      floor = 0
    }
  }
}
