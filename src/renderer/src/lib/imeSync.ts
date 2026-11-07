/**
 * Tracks what the remote input line holds while an IME (notably voice input)
 * types into xterm's hidden textarea.
 *
 * `term.onData` is xterm's way of saying "the user produced these bytes — send
 * them". It does NOT write to the SSH channel itself; the caller does. An
 * earlier revision of this file assumed the opposite and returned '' for every
 * payload, which silently swallowed *all* keyboard input (English included).
 *
 * The duplication users saw with voice input had a different cause: the
 * composition-end safety net re-sent text that `onData` had already handed to
 * the caller. So:
 *   - `input()` always returns what must go on the wire (i.e. `data`), and only
 *     records it;
 *   - `sync()` sends text xterm never emitted (some voice IMEs write straight
 *     into the textarea) and refuses anything already accounted for.
 *
 * Control keys are the one thing the textarea cannot express: `\r` starts a new
 * line, `DEL` removes a character, Ctrl+U clears it. They update the record and
 * still go out unchanged.
 */

const DEL = '\x7f'
/** Cap on the tracked line. A line longer than this is recorded by its tail;
 *  the worst case is one full resend on a catch-up, never a duplicate. */
const MAX_TRACKED = 8192
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
  /** What must reach the remote for one xterm `onData` payload. Always the
   *  payload itself — `onData` is the request to send, not a report of a send. */
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
        else if (data === '\x15' || data === '\x03') {
          // Ctrl+U clears the line; Ctrl+C cancels it (readline discards the
          // buffer). Either way the remote line is empty afterwards, and
          // keeping the old text made the next catch-up resend a whole line.
          synced = ''
          lastSent = ''
        }
        // Still has to go out: returning '' here swallowed every arrow key,
        // Tab and Ctrl+C.
        return data
      }
      // Record it and send it. `onData` asks the caller to write these bytes —
      // returning '' (as one revision did) lost every keystroke.
      synced = (synced + data).slice(-MAX_TRACKED)
      lastSent = data
      return data
    },

    sync(settled) {
      if (!settled) return ''
      // The most reliable check: this text is already at the end of the line we
      // have sent. Voice IMEs commit a whole sentence through `onData` and then
      // fire compositionend for the very same text — that second pass is the
      // duplicate users reported.
      if (synced.endsWith(settled)) return ''
      // Same commit, reported twice (onData, then input/compositionend).
      if (
        lastSent &&
        (lastSent === settled || (lastSent.length >= 2 && settled.endsWith(lastSent)))
      ) {
        lastSent = ''
        return ''
      }
      // If the textarea carries the whole line, send only what is missing.
      // Otherwise it is new text typed into a freshly-cleared box: send it all.
      const missing = settled.startsWith(synced) ? settled.slice(synced.length) : settled
      if (!missing) return ''
      synced = (synced + missing).slice(-MAX_TRACKED)
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
