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

/** A terminal backspace removes one character, not one UTF-16 unit. */
const charCount = (s: string): number => Array.from(s).length

/** Drops the last character (a surrogate pair counts as one). */
const chopLast = (s: string): string => Array.from(s).slice(0, -1).join('')

export function createImeMirror(): ImeMirror {
  /** What the remote line currently holds, as far as we know. */
  let synced = ''
  /** The last payload xterm emitted for the current commit. A composition
   *  usually produces BOTH an onData and an input event; `sync()` must
   *  recognise the second one as already sent. */
  let lastSent = ''
  /**
   * Text the current dictation run has already put on the wire.
   *
   * A voice IME does not commit once: it posts a rough guess, then revises it —
   * "对", "对对", "对的，谢谢你" — and every revision is the *whole* draft, not
   * an addition to it. So when the new value is not an extension of the old
   * one, the old one was replaced and has to be erased before the new one goes
   * out. (Character-similarity heuristics were tried and are not needed: the
   * draft is either a prefix or a replacement.)
   *
   * Reset whenever the user types with the keyboard or ends the line, so a
   * correction can never reach back into hand-typed input.
   */
  let committed = ''

  return {
    input(data, { eventType }) {
      // A paste is not dictation. Older shells deliver it as plain text, and
      // treating it as a draft meant the next voice correction erased it.
      const pasted =
        eventType === 'paste' || eventType === 'drop' || data.startsWith('\x1b[200~')
      if (pasted) {
        committed = ''
        lastSent = ''
        synced = (synced + data).slice(-MAX_TRACKED)
        return data
      }
      const fromKey = eventType === 'keydown' || eventType === 'keypress'
      if (!isPlainText(data)) {
        // A timer-driven reply (cursor-position query, etc.) says nothing
        // about the line; a user key does.
        if (eventType === undefined) return data
        if (data === '\r' || data === '\n') {
          synced = ''
          committed = ''
          lastSent = ''
        } else if (data === DEL) {
          // One character, not one UTF-16 unit — otherwise an emoji or an
          // extension-B hanzi leaves half a surrogate pair behind and the next
          // correction sends one DEL too many.
          synced = chopLast(synced)
          committed = chopLast(committed)
        } else if (data === '\x15' || data === '\x03') {
          // Ctrl+U clears the line; Ctrl+C cancels it (readline discards the
          // buffer). Either way the remote line is empty afterwards, and
          // keeping the old text made the next catch-up resend a whole line.
          synced = ''
          committed = ''
          lastSent = ''
        } else if (fromKey) {
          // Keyboard input ends the dictation run: a later correction must not
          // delete what was just typed by hand.
          committed = ''
        }
        // Still has to go out: returning '' here swallowed every arrow key,
        // Tab and Ctrl+C.
        return data
      }
      // Record it and send it. `onData` asks the caller to write these bytes —
      // returning '' (as one revision did) lost every keystroke.
      synced = (synced + data).slice(-MAX_TRACKED)
      committed = fromKey ? '' : (committed + data).slice(-MAX_TRACKED)
      lastSent = data
      return data
    },

    sync(settled) {
      if (!settled) return ''
      // The same draft posted again.
      if (settled === committed) return ''
      // Already at the end of the line we have sent (an IME may post a sentence
      // through `onData` and then fire compositionend for the very same text).
      if (synced.endsWith(settled)) return ''
      // The exact payload xterm just handed us, reported a second time.
      if (lastSent && settled === lastSent) {
        lastSent = ''
        return ''
      }

      // Only a draft we know is the tail of the line can be erased safely.
      if (committed && synced.endsWith(committed)) {
        if (settled.startsWith(committed)) {
          // The IME extended the draft: only the added tail is new.
          const add = settled.slice(committed.length)
          committed = settled
          synced = (synced + add).slice(-MAX_TRACKED)
          return add
        }
        // The IME replaced the draft ("对" → "对对" → "对的，谢谢你"). A
        // terminal has no replace, so erase what we sent and retype the rest.
        const dels = DEL.repeat(charCount(committed))
        const base = synced.slice(0, synced.length - committed.length)
        synced = (base + settled).slice(-MAX_TRACKED)
        committed = settled
        lastSent = ''
        return dels + settled
      }

      // Unrelated text, or the first commit of a run: plain append.
      committed = settled
      synced = (synced + settled).slice(-MAX_TRACKED)
      return settled
    },

    adopt(baseline) {
      // The remote does not have this text, but neither will we send it again:
      // recording it keeps `sync()` from repeating it later.
      synced = baseline
      // Not dictation: the next commit must not erase it.
      committed = ''
    },

    clear() {
      // Intentionally does NOT reset `synced`: xterm clears the textarea after
      // committing, and the remote line still holds what was committed.
    }
  }
}
