/**
 * Tracks what the remote input line holds while an IME (notably voice input)
 * types into xterm's hidden textarea.
 *
 * The fact the previous design got wrong: **`term.onData` IS xterm's send
 * path.** When it fires, the payload has already been written to the SSH
 * channel. Mirroring that payload back — as a diff, as a resend, in any form —
 * puts it on the wire twice, which is exactly the duplicated dictation users
 * saw (`默认把API key默认把API key`). A "reconcile the textarea against a mirror"
 * model cannot work, because xterm empties the textarea after every commit:
 * the textarea is a drop box for the *next* commit, not a view of the line.
 *
 * So `input()` never re-sends plain text; it only records it. `sync()` is the
 * safety net for text xterm did NOT emit (some voice IMEs write straight into
 * the textarea), and it sends only the part the remote does not already have.
 *
 * Control keys are the one thing the textarea cannot express: `\r` starts a new
 * line, `DEL` removes a character, Ctrl+U clears it. They update the record
 * without changing what goes on the wire.
 */

const DEL = '\x7f'
const CONTROL = /[\x00-\x1f\x7f]/

/** Printable text only — no C0 controls, DEL or escape sequences. */
export const isPlainText = (data: string): boolean => data !== '' && !CONTROL.test(data)

export interface ImeInputContext {
  /** xterm's hidden textarea, minus any composition still in progress. Kept in
   *  the signature for callers; the mirror no longer needs it to decide. */
  settled: string
  /**
   * Type of the DOM event being dispatched when xterm emitted the data
   * (`window.event`), or undefined when it came from a timer — which is how
   * xterm sends a finished composition.
   */
  eventType: string | undefined
}

export interface ImeMirror {
  /** What should additionally reach the remote for one xterm `onData` payload.
   *  Empty for plain text: xterm already sent it. */
  input(data: string, ctx: ImeInputContext): string
  /**
   * The part of `settled` the remote does not have yet, for commits xterm
   * emitted nothing for. Empty when already in step.
   */
  sync(settled: string): string
  /** Record text xterm itself put in the textarea (right-click copy, paste). */
  adopt(baseline: string): void
  /** The textarea was emptied without ending the line. The remote line is
   *  unchanged, so nothing to do — kept for callers. */
  clear(): void
}

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
  /** What the remote line currently holds, as far as we know. */
  let synced = ''
  /** The last payload xterm emitted for the current commit. A composition
   *  usually produces BOTH an onData and an input event; `sync()` must
   *  recognise the second one as already sent. */
  let lastSent = ''

  return {
    input(data, { eventType }) {
      if (!isPlainText(data)) {
        // A timer-driven reply (cursor-position query, etc.) says nothing
        // about the line; a user key does.
        if (eventType === undefined) return data
        if (data === '\r' || data === '\n') {
          synced = ''
          lastSent = ''
        } else if (data === DEL) synced = synced.slice(0, -1)
        else if (data === '\x15') synced = '' // Ctrl+U
        // xterm already sent it. Returning `data` here sent every arrow key,
        // Tab and Ctrl+C to the shell twice — the same duplication as text,
        // just less visible.
        return ''
      }
      // xterm already sent this text. Recording it is the whole job — sending
      // it again is the duplicate this module exists to prevent.
      synced += data
      lastSent = data
      return ''
    },

    sync(settled) {
      if (!settled) return ''
      // A composition normally produces an onData AND an input/compositionend
      // event for the same text. If xterm already emitted it, the catch-up must
      // do nothing — this is the duplicate path that survived the previous fix.
      if (lastSent && (lastSent === settled || settled.endsWith(lastSent) || lastSent.endsWith(settled))) {
        lastSent = ''
        return ''
      }
      // If the textarea carries the whole line, send only what is missing.
      // Otherwise it is new text typed into a freshly-cleared box: send it all.
      const missing = settled.startsWith(synced) ? settled.slice(synced.length) : settled
      if (!missing) return ''
      synced += missing
      return missing
    },

    adopt(baseline) {
      // The remote does not have this text, but neither will we send it again:
      // recording it keeps `sync()` from repeating it later.
      synced = baseline
    },

    clear() {
      // Intentionally does NOT reset `synced`: xterm clears the textarea after
      // committing, and the remote line still holds what was committed.
    }
  }
}
