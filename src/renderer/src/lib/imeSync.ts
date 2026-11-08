/**
 * Tracks what the remote input line holds while an IME (notably voice input)
 * types into xterm's hidden textarea.
 *
 * `term.onData` is xterm's way of saying "the user produced these bytes — send
 * them". It does NOT write to the SSH channel itself; the caller does. An
 * earlier revision of this file assumed the opposite and returned '' for every
 * payload, which silently swallowed *all* keyboard input (English included).
 *
 * ## The model (and the bug it replaced)
 *
 * xterm never empties its textarea between commits — only on Enter, Ctrl+C,
 * blur and paste. So the textarea ACCUMULATES: after dictating "A" then "B" it
 * holds "AB", and a voice IME that re-reads its audio can leave "V1V2" in it.
 * The textarea is therefore NOT the remote line, and mirroring its whole value
 * (what `sync()` used to do) re-sent every earlier version on top of the
 * correction that `input()` had just applied. That is the "two versions
 * stacked on one line" bug that survived six fixes: each catch-up looked at
 * the full textarea, found it different from the draft, and "corrected" the
 * line into V1+V2.
 *
 * So both entry points now work on the CHANGE the textarea went through since
 * we last looked (`diff`), never on its absolute value:
 *   - text replaced at the tail (the IME edited its own draft in place):
 *     erase exactly that tail on the remote and type the replacement;
 *   - text appended: either a new sentence, or the IME re-posting a revised
 *     version of the draft — told apart by the draft we recorded.
 * A second report of a change we already applied is a no-op by construction,
 * which is what makes `onData` + `input` + `compositionend` — all firing for
 * one commit — safe to combine.
 *
 * Control keys are the one thing the textarea cannot express: `\r` starts a new
 * line, `DEL` removes a character, Ctrl+U clears it. They update the record and
 * still go out unchanged.
 */

const DEL = '\x7f'
/** Cap on the tracked draft. A longer one is recorded by its tail; the worst
 *  case is a short erase, never a duplicate. */
const MAX_TRACKED = 8192
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
  /** What must reach the remote for one xterm `onData` payload. */
  input(data: string, ctx: ImeInputContext): string
  /**
   * What must reach the remote because the textarea now reads `settled`.
   * Empty when already in step.
   */
  sync(settled: string): string
  /** Record text xterm itself put in the textarea (right-click copy, paste).
   *  It is not dictation, so the next commit must not erase it. */
  adopt(baseline: string): void
  /** The textarea shrank (an IME deletion). Record it WITHOUT ending the
   *  dictation run — an IME that rewrites by deleting then re-inserting must
   *  still be recognised as correcting its draft. */
  track(value: string): void
  /** xterm emptied the textarea (Enter, Ctrl+C, blur, paste). */
  clear(): void
}

/** Drops the last character (a surrogate pair counts as one). */
const chopLast = (s: string): string => Array.from(s).slice(0, -1).join('')

/** Code points in `s`. */
const countChars = (s: string): number => Array.from(s).length

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
 * Doubao/WeChat re-read and rewrite what they committed, so a single dictation
 * produces several full versions of the same sentence. Sharing a run of three
 * consecutive characters is a much sharper signal than character overlap:
 * "重启服务" vs "重启机器" shares only two, while every rewrite of the same
 * sentence shares a phrase.
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

/**
 * What changed between two textarea values, assuming edits happen at the tail
 * (which is where an IME works): the common prefix stays, `removed` is what the
 * old value had after it and `added` what the new one has.
 */
function diff(prev: string, next: string): { removed: string; added: string } {
  const n = Math.min(prev.length, next.length)
  let p = 0
  while (p < n && prev.charCodeAt(p) === next.charCodeAt(p)) p++
  // Never split a surrogate pair between "kept" and "changed".
  if (p > 0 && p < prev.length + 1) {
    const unit = prev.charCodeAt(p - 1)
    if (unit >= 0xd800 && unit <= 0xdbff) p--
  }
  return { removed: prev.slice(p), added: next.slice(p) }
}

export function createImeMirror(): ImeMirror {
  const mirror = createBareMirror()
  return debugEnabled() ? withDebug(mirror) : mirror
}

/** The real implementation; `createImeMirror` optionally wraps it in a logger. */
function createBareMirror(): ImeMirror {
  /** The textarea value as of the last event we accounted for. */
  let ta = ''
  /**
   * Text the current dictation run has already put on the wire — the draft.
   *
   * A voice IME does not commit once: it posts a rough guess, then revises it —
   * "对", "对对", "对的，谢谢你". The line has to end up holding only the last
   * version, so the recorded draft is what a revision is measured against.
   *
   * Reset whenever the user types with the keyboard or ends the line, so a
   * correction can never reach back into hand-typed input.
   */
  let committed = ''

  /** A commit that ADDS `text` to the textarea. Either a new sentence or the
   *  IME's revised take on the draft. */
  function append(text: string): string {
    if (!text) return ''
    // A draft shorter than a phrase cannot be told apart from a new word
    // ("对" then "对": two words, not a re-read), so it is never a revision.
    if (countChars(committed) >= REWRITE_RUN) {
      // The same version again, or a longer take on it: only the tail is new.
      if (text.startsWith(committed)) {
        const tail = text.slice(committed.length)
        committed = text.slice(-MAX_TRACKED)
        return tail
      }
      // A re-read of the same audio. A terminal has no replace, so erase the
      // differing tail of the draft and retype the rest.
      if (longestSharedRun(committed, text) >= REWRITE_RUN) {
        const out = rewriteBytes(committed, text)
        committed = text.slice(-MAX_TRACKED)
        return out
      }
    }
    committed = (committed + text).slice(-MAX_TRACKED)
    return text
  }

  /** The textarea now reads `settled`; `data` is what xterm reported for it, if
   *  anything. Returns the bytes the remote is missing. */
  function reconcile(settled: string, data?: string): string {
    if (settled === ta) {
      // The textarea has nothing new. Either this is the second report of a
      // commit we already handled (onData, then input, then compositionend all
      // fire for one commit), or the IME produced text without touching the
      // textarea at all.
      if (!data || ta.endsWith(data)) return ''
      return append(data)
    }

    const { removed, added } = diff(ta, settled)
    ta = settled
    if (removed) {
      // The IME edited its own text in place ("对对" → "对的，谢谢你"). The
      // remote line ends with that text if it was dictated; erase exactly what
      // was replaced and type what replaced it.
      if (committed.endsWith(removed)) {
        committed = (committed.slice(0, committed.length - removed.length) + added).slice(
          -MAX_TRACKED
        )
        return DEL.repeat(countChars(removed)) + added
      }
      // The replaced text is not ours to erase (hand-typed, or already dropped
      // from the record): add what is new, touch nothing else.
    }
    return append(added)
  }

  return {
    input(data, { settled, eventType }) {
      // A paste is not dictation. Older shells deliver it as plain text, and
      // treating it as a draft meant the next voice correction erased it.
      const pasted =
        eventType === 'paste' || eventType === 'drop' || data.startsWith('\x1b[200~')
      if (pasted) {
        committed = ''
        ta = settled
        return data
      }
      const fromKey = eventType === 'keydown' || eventType === 'keypress'
      if (!isPlainText(data)) {
        if (eventType === undefined) {
          // xterm's own correction for a character the IME removed from the
          // textarea (`_handleAnyTextareaChanges`): the textarea is already
          // shorter, and the remote is about to be.
          if (data === DEL) {
            committed = chopLast(committed)
            ta = settled
          }
          // Any other timer-driven reply (cursor-position query, etc.) says
          // nothing about the line.
          return data
        }
        if (data === '\r' || data === '\n') {
          committed = ''
        } else if (data === DEL) {
          // One character, not one UTF-16 unit — otherwise an emoji or an
          // extension-B hanzi leaves half a surrogate pair behind and the next
          // correction sends one DEL too many.
          committed = chopLast(committed)
        } else if (data === '\x15' || data === '\x03') {
          // Ctrl+U clears the line; Ctrl+C cancels it (readline discards the
          // buffer). Either way the remote line is empty afterwards.
          committed = ''
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
        // Typed by hand: the dictation run ends here so a later correction
        // cannot delete it. xterm cancels the key, so the textarea normally
        // did not change — but a composition finished by this key did, and
        // that text is going out right now.
        committed = ''
        ta = settled
        return data
      }

      // Everything else is an IME commit. What it means is decided by how the
      // textarea changed, not by the payload: for a composition that replaced
      // text in place xterm's payload is a meaningless fragment of the new
      // value, while the textarea is exact.
      return reconcile(settled, data)
    },

    sync(settled) {
      return reconcile(settled)
    },

    adopt(baseline) {
      // The remote does not have this text, but neither will we send it again.
      ta = baseline
      // Not dictation: the next commit must not erase it.
      committed = ''
    },

    track(value) {
      ta = value
    },

    clear() {
      ta = ''
      committed = ''
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
        settled: clip(ctx.settled),
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
    track(value) {
      inner.track(value)
      console.log('[ime] track', clip(value))
    },
    clear() {
      inner.clear()
      console.log('[ime] clear')
    }
  }
}
