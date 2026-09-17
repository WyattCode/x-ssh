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
   * Accept the textarea's current text as already accounted for, and never
   * erase it: the remote line has changed in a way the textarea doesn't show
   * (a keystroke), or xterm wrote the textarea itself (right-click copy).
   */
  adopt(baseline: string): void
  /** The textarea was emptied behind our back (xterm does this on blur). */
  clear(): void
}

/** Event types during which xterm's own IME paths emit text. */
const imeEvent = (type: string | undefined): boolean =>
  type === undefined || type === 'input' || type === 'compositionend'

export function createImeMirror(): ImeMirror {
  /** Textarea text already reflected on the remote (or deliberately left alone). */
  let synced = ''
  /** Leading characters of `synced` that must never be erased. */
  let floor = 0

  function adopt(baseline: string): void {
    synced = baseline
    floor = Array.from(baseline).length
  }

  function reconcile(next: string): string {
    const a = Array.from(synced)
    const b = Array.from(next)
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let out: string
    if (p >= floor) {
      out = DEL.repeat(a.length - p) + b.slice(p).join('')
    } else {
      // The change reaches into text we must not touch (it predates a manual
      // edit, or never went to the remote at all). Erase only what we own and
      // send the rest as new — a possible duplicate, never a wrong deletion.
      // From here the remote line ends with b[p..] only; b[0..p) is still the
      // untouched text, so it stays protected.
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
        if (eventType !== undefined) adopt(settled)
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
