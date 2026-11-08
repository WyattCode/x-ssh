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

/** Drops the last character (a surrogate pair counts as one). */
const chopLast = (s: string): string => Array.from(s).slice(0, -1).join('')

/** Longest run of consecutive characters present in both strings, capped so a
 *  pathological draft cannot stall a keystroke. */
function longestSharedRun(a: string, b: string, limit = 160): number {
  const A = Array.from(a.slice(0, limit))
  const B = Array.from(b.slice(0, limit))
  if (!A.length || !B.length) return 0
  let best = 0
  let prev = new Array<number>(B.length + 1).fill(0)
  for (let i = 1; i <= A.length; i++) {
    const cur = new Array<number>(B.length + 1).fill(0)
    for (let j = 1; j <= B.length; j++) {
      if (A[i - 1] === B[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
    if (best >= limit) break
  }
  return best
}

/**
 * Whether `next` looks like another pass over the same audio rather than a
 * different sentence.
 *
 * Doubao/WeChat now re-read and rewrite what they committed, so a single
 * dictation produces several full versions of the same sentence. Sharing a run
 * of three consecutive characters is a much sharper signal than character
 * overlap: "重启服务" vs "重启机器" shares only two, while every rewrite of the
 * same sentence shares a phrase.
 */
const REWRITE_RUN = 3

/**
 * Set `localStorage['xssh.imeDebug'] = '1'` and reload to trace every decision
 * this module makes. Without this, diagnosing a specific IME means guessing at
 * the event sequence — which is exactly how several "fixes" were shipped and
 * then found not to work.
 */
const debugEnabled = (): boolean => {
  try {
    return window.localStorage.getItem('xssh.imeDebug') === '1'
  } catch {
    return false
  }
}

let debugOn: boolean | undefined
function trace(...args: unknown[]): void {
  if (debugOn === undefined) debugOn = debugEnabled()
  if (debugOn) console.log('[ime]', ...args)
}

/**
 * Turns "the line currently ends with `prev`, and the IME now wants `next`"
 * into the bytes that get it there: backspace over the part that differs, then
 * type the replacement.
 *
 * Only the diverging tail is erased. Erasing the whole previous version and
 * retyping it sent dozens of backspaces plus a long string in one write, which
 * a TUI input line can drop.
 */
function rewriteBytes(prev: string, next: string): string {
  const A = Array.from(prev)
  const B = Array.from(next)
  let p = 0
  while (p < A.length && p < B.length && A[p] === B[p]) p++
  return DEL.repeat(A.length - p) + B.slice(p).join('')
}

export function createImeMirror(): ImeMirror {
  const mirror = createBareMirror()
  return debugEnabled() ? withDebug(mirror) : mirror
}

/** The real implementation; `createImeMirror` optionally wraps it in a logger. */
function createBareMirror(): ImeMirror {
  /** What the remote line currently holds, as far as we know. */
  let synced = ''  /** The last payload xterm emitted for the current commit. A composition
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
        }
        // Arrow keys, Esc, Tab and friends must NOT end the dictation run.
        // They are pressed constantly while editing in a TUI, and clearing the
        // draft on them meant the next voice commit looked like brand-new text
        // and was appended instead of replacing the previous version.
        // Still has to go out: returning '' here swallowed every arrow key,
        // Tab and Ctrl+C.
        return data
      }
      // ---- plain text ----
      if (fromKey) {
        // Typed by hand: an incremental character, and the dictation run ends
        // here so a later correction cannot delete it.
        synced = (synced + data).slice(-MAX_TRACKED)
        committed = ''
        lastSent = data
        return data
      }

      // Everything else is an IME commit. Modern voice IMEs post the WHOLE
      // draft each time they re-read the audio, so a commit may be a revision
      // of what is already on the wire rather than an addition to it. Handling
      // only the append case here is what produced
      // "二次审查代码检查 ui 细节检查审查代码二次审查代码，…".
      if (committed) {
        // The same version again.
        if (data === committed) return ''
        // A longer take on the same draft: only the new tail is missing.
        if (data.startsWith(committed)) {
          const add = data.slice(committed.length)
          synced = (synced + add).slice(-MAX_TRACKED)
          committed = data
          lastSent = add
          return add
        }
        // A re-read of the same audio. `synced` is NOT consulted here: the DOM
        // input handler overwrites it with the textarea's new value for input
        // types it does not recognise, which made "is the old version still the
        // tail of the line?" false and sent the new version as an append. The
        // draft we recorded is the one we wrote, and hand-typed text clears it,
        // so it is the reliable anchor.
        if (longestSharedRun(committed, data) >= REWRITE_RUN) {
          const out = rewriteBytes(committed, data)
          synced = (synced.endsWith(committed)
            ? synced.slice(0, synced.length - committed.length) + data
            : data
          ).slice(-MAX_TRACKED)
          committed = data
          lastSent = data
          return out
        }
      }

      // New text in the same run: append and remember the whole version.
      synced = (synced + data).slice(-MAX_TRACKED)
      committed = (committed + data).slice(-MAX_TRACKED)
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

      // A draft we recorded is the anchor. `synced` is deliberately NOT used
      // to decide whether the draft is still on the line: the DOM input handler
      // overwrites `synced` with the textarea's new value for input types it
      // does not recognise, which made this test false and turned every
      // correction into an append.
      if (committed) {
        if (settled.startsWith(committed)) {
          // The IME extended the draft: only the added tail is new.
          const add = settled.slice(committed.length)
          committed = settled
          synced = (synced + add).slice(-MAX_TRACKED)
          return add
        }
        // The IME re-read the audio ("对" → "对对" → "对的，谢谢你"). A terminal
        // has no replace, so erase the differing tail and retype the rest.
        const out = rewriteBytes(committed, settled)
        synced = (synced.endsWith(committed)
          ? synced.slice(0, synced.length - committed.length) + settled
          : settled
        ).slice(-MAX_TRACKED)
        committed = settled
        lastSent = ''
        return out
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

/** Shortens a payload for the debug log without hiding its shape. */
const clip = (s: string): string => (s.length > 60 ? `${s.slice(0, 60)}…(${s.length})` : s)

/**
 * Wraps a mirror so every call is logged when `xssh.imeDebug` is on.
 *
 * The log line answers the three questions a distant debugger cannot:
 * how many commits the IME actually makes, what each one contains, and whether
 * we decided to erase anything (`out` starting with \x7f).
 */
function withDebug(inner: ImeMirror): ImeMirror {
  return {
    input(data, ctx) {
      const out = inner.input(data, ctx)
      console.log('[ime] input', {
        eventType: ctx.eventType ?? '(timer)',
        data: clip(data),
        out: clip(out),
        erased: out.startsWith(DEL)
      })
      return out
    },
    sync(settled) {
      const out = inner.sync(settled)
      console.log('[ime] sync', { settled: clip(settled), out: clip(out), erased: out.startsWith(DEL) })
      return out
    },
    adopt(baseline) {
      inner.adopt(baseline)
      console.log('[ime] adopt', clip(baseline))
    },
    clear() {
      inner.clear()
    }
  }
}
