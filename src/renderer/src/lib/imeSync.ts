/**
 * Tracks what the remote input line holds while an IME (notably voice input)
 * types into xterm's hidden textarea.
 *
 * `term.onData` is xterm's way of saying "the user produced these bytes — send
 * them". It does NOT write to the SSH channel itself; the caller does. An
 * earlier revision of this file assumed the opposite and returned '' for every
 * payload, which silently swallowed *all* keyboard input (English included).
 *
 * ## What a real voice IME does (observed, not assumed)
 *
 * Doubao's dictation is ONE long composition. While it runs the draft lives in
 * the textarea; partway through, the IME fires a fake key (keyCode 252), which
 * makes xterm finish the composition on the spot and send the *untidied draft*
 * as if it had been typed (`onData` with eventType `keydown`). When the
 * "smart tidy-up" finishes, the textarea text is replaced in place by the
 * rewritten version — often several lines — and xterm reports that once, later,
 * from a timer. The remote line therefore holds a draft that looks hand-typed
 * and has to be erased and retyped.
 *
 * ## The model
 *
 * xterm never empties its textarea between commits — only on Enter, Ctrl+C,
 * blur and paste. So the textarea ACCUMULATES, and is NOT the remote line:
 * mirroring its whole value re-sent every earlier version on top of a correction
 * that had just been applied. Both entry points therefore work on the CHANGE the
 * textarea went through since we last looked (`diff`), never on its value:
 *   - text replaced at the tail (the IME edited its own draft in place): if the
 *     remote LINE ends with that text, erase exactly it and type the
 *     replacement — whether or not it was dictated or looked hand-typed;
 *   - text appended: a new sentence, or the IME re-posting a revised version of
 *     the dictation run, told apart by the run recorded at the end of the line.
 * A second report of a change we already applied is a no-op by construction,
 * which is what makes `onData` + `input` + `compositionend` — all firing for
 * one commit — safe to combine.
 *
 * Escape sequences (mouse and focus reports, cursor-position replies, arrow
 * keys) are never line content and are never recorded as such.
 */

const DEL = '\x7f'
/** Cap on the tracked line. A longer one is recorded by its tail; the worst
 *  case is a short erase, never a duplicate. */
const MAX_TRACKED = 8192
const CONTROL = /[\x00-\x1f\x7f]/

/** Printable text only — no C0 controls, DEL or escape sequences. */
export const isPlainText = (data: string): boolean => data !== '' && !CONTROL.test(data)

/**
 * Text an IME can commit: at least one printable character, and no control
 * characters other than tab and LF. A restructured dictation contains line
 * breaks, but a CR is what xterm turns a *paste's* line breaks into, so CR
 * never counts — pasted text must not be mistaken for dictation.
 */
export const isImeText = (data: string): boolean =>
  /[^\x00-\x1f\x7f]/.test(data) && !/[\x00-\x08\x0b-\x1f\x7f]/.test(data)

/**
 * One escape sequence: legacy mouse report (ESC [ M + 3 raw bytes), CSI, OSC, or
 * ESC + one character (Alt-key, SS3 prefix). They carry no line text; recording
 * their printable tail ("[<35;12;5M", "[A") made the line look like it ended
 * with garbage, so a correction could no longer find the text it had to erase.
 */
const ESC_SEQ =
  /\x1b\[M[\s\S]{3}|\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bO[\s\S]|\x1b[\s\S]/g

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

/** UTF-16 length of the last character of `s` (a surrogate pair is one). */
function lastCharLength(s: string): number {
  if (!s) return 0
  const low = s.charCodeAt(s.length - 1)
  if (s.length >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = s.charCodeAt(s.length - 2)
    if (high >= 0xd800 && high <= 0xdbff) return 2
  }
  return 1
}

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
  // Never split a surrogate pair between "kept" and "changed". The prefix is
  // identical on both sides, so looking at `prev` is enough.
  if (p > 0) {
    const unit = prev.charCodeAt(p - 1)
    if (unit >= 0xd800 && unit <= 0xdbff) p--
  }
  return { removed: prev.slice(p), added: next.slice(p) }
}

export function createImeMirror(): ImeMirror {
  /** The textarea value as of the last event we accounted for. */
  let ta = ''
  /**
   * Everything this mirror has put on the remote line since it was last empty,
   * hand-typed text included. A correction may erase the textarea text the IME
   * replaced whenever the line really ends with it — that must not depend on a
   * dictation record surviving, or one stray reset turns a correction into
   * "append the new tail, leave the old one": the half-erased lines users saw.
   */
  let line = ''
  /**
   * How much of the END of `line` belongs to the current dictation run (UTF-16
   * units). The run — the draft a revision is measured against — is derived
   * from `line` instead of being kept as a second string, so the two cannot
   * drift apart. Zero after hand-typed text, a paste, Enter, or a cleared box,
   * so a correction can never reach back into input the user typed.
   */
  let runLen = 0
  const draft = (): string => line.slice(line.length - runLen)

  /**
   * Records bytes headed for the remote. `imeText` marks IME output, whose line
   * breaks are part of the text; for anything else a CR/LF submits the line.
   */
  function note(out: string, imeText: boolean): void {
    for (const ch of Array.from(out.replace(ESC_SEQ, ''))) {
      if (ch === DEL) {
        const n = lastCharLength(line)
        line = line.slice(0, line.length - n)
        runLen = Math.max(0, runLen - n)
      } else if (ch === '\x15' || ch === '\x03') {
        // Ctrl+U clears the line; Ctrl+C cancels it (readline discards the
        // buffer). Either way the remote line is empty afterwards.
        line = ''
        runLen = 0
      } else if (ch === '\r' || ch === '\n') {
        if (imeText) {
          line += ch
        } else {
          line = ''
          runLen = 0
        }
      } else if (ch >= ' ') {
        line += ch
      }
    }
    if (line.length > MAX_TRACKED) line = line.slice(-MAX_TRACKED)
    runLen = Math.min(runLen, line.length)
  }

  /** A commit that ADDS `text` to the textarea. Either a new sentence or the
   *  IME's revised take on the dictation run. `run` is the new run length. */
  function append(text: string): { out: string; run: number } {
    if (!text) return { out: '', run: runLen }
    const d = draft()
    // A draft shorter than a phrase cannot be told apart from a new word
    // ("对" then "对": two words, not a re-read), so it is never a revision.
    if (countChars(d) >= REWRITE_RUN) {
      // The same version again, or a longer take on it: only the tail is new.
      if (text.startsWith(d)) return { out: text.slice(d.length), run: text.length }
      // A re-read of the same audio. A terminal has no replace, so erase the
      // differing tail of the draft and retype the rest.
      if (longestSharedRun(d, text) >= REWRITE_RUN) {
        return { out: rewriteBytes(d, text), run: text.length }
      }
    }
    return { out: text, run: runLen + text.length }
  }

  /** The textarea now reads `settled`; `data` is what xterm reported for it, if
   *  anything. Returns the bytes the remote is missing. */
  function reconcile(settled: string, data?: string): string {
    const { out, run } = plan(settled, data)
    note(out, true)
    runLen = Math.min(run, line.length)
    return out
  }

  function plan(settled: string, data?: string): { out: string; run: number } {
    if (settled === ta) {
      // The textarea has nothing new. Either this is the second report of a
      // commit we already handled (onData, then input, then compositionend all
      // fire for one commit), or the IME produced text without touching the
      // textarea at all.
      //
      // A multi-line insertion lands in the textarea in one piece, after which
      // Chromium fires one `input` event per line and xterm reports each line
      // as its own payload — every one of them already accounted for. So "the
      // text is somewhere in the textarea" is enough to ignore a payload; only
      // text the textarea does not hold at all counts as untracked.
      if (!data || ta.includes(data)) return { out: '', run: runLen }
      return append(data)
    }

    const { removed, added } = diff(ta, settled)
    ta = settled
    if (removed) {
      // The IME edited its own text in place ("对对" → "对的，谢谢你"). If the
      // remote line ends with that text — dictated or not — erase exactly what
      // was replaced and type what replaced it.
      if (line.endsWith(removed)) {
        const d = draft()
        const kept = d.endsWith(removed) ? d.length - removed.length : 0
        return { out: DEL.repeat(countChars(removed)) + added, run: kept + added.length }
      }
      // The replaced text is no longer at the end of the line (something was
      // typed after it): add what is new, touch nothing else.
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
        ta = settled
        // Pasted line breaks may submit the line, so they end it here.
        note(data, false)
        runLen = 0
        return data
      }
      const fromKey = eventType === 'keydown' || eventType === 'keypress'
      // Doubao's "smart text tidy-up" has a model restructure the dictation into
      // paragraphs and numbered lists, so an IME commit can legitimately carry
      // line breaks. Those are text, not a key: treating them as control input
      // sent the whole rewrite through untouched, with the old version still on
      // the line.
      if (!fromKey && isImeText(data)) return reconcile(settled, data)
      if (!isPlainText(data)) {
        // xterm's own correction for a character the IME removed from the
        // textarea (`_handleAnyTextareaChanges`): the textarea is already
        // shorter, and the remote is about to be.
        if (eventType === undefined && data === DEL) ta = settled
        // Everything else — user keys, and timer-driven replies such as a
        // cursor-position report — goes out unchanged. `note` ignores escape
        // sequences, so arrow keys, mouse and focus reports neither pollute the
        // line nor end the dictation run (they are pressed constantly while
        // editing in a TUI); backspace, Enter and Ctrl+C/U update it. Dropping
        // them here would swallow every arrow key, Tab and Ctrl+C.
        note(data, false)
        return data
      }
      // ---- plain text ----
      if (fromKey) {
        // Typed by hand: the dictation run ends here so a later correction
        // cannot delete it. xterm cancels the key, so the textarea normally
        // did not change — but a composition finished by this key did (the
        // untidied draft Doubao's fake keyCode-252 key forces out), and that
        // text is going out right now: it stays on the line, erasable.
        ta = settled
        note(data, false)
        runLen = 0
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
      runLen = 0
    },

    track(value) {
      ta = value
    },

    clear() {
      ta = ''
      runLen = 0
    }
  }
}
