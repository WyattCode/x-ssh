/** Decode OSC 52 clipboard payload (base64 after the first ';').
 *  Returns UTF-8 text, or null for query/empty/invalid/too-large. */
export function decodeOsc52Payload(payload: string, maxLen = 2_000_000): string | null {
  if (!payload || payload === '?') return null
  // Some remotes (tmux wrapping, multi-line OSC) put newlines/spaces inside the
  // base64. atob() rejects those, which used to make the copy fail silently.
  const b64 = payload.replace(/\s+/g, '')
  if (!b64 || b64 === '?' || b64.length > maxLen) return null
  try {
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * How long after a qualifying user action a remote clipboard write is honoured.
 * Generous on purpose: the action is timed locally, the write arrives after a
 * network round trip, and on a laggy link 5 s dropped legitimate copies.
 */
export const OSC52_USER_WINDOW_MS = 10_000

/**
 * Does a full-screen / mouse-owning program have the terminal right now?
 * (alternate screen: tmux, vim, less…; mouse tracking: Codex and other inline TUIs)
 */
export function programOwnsTerminal(state: { mouseTracking: string; altScreen: boolean }): boolean {
  return state.altScreen || state.mouseTracking !== 'none'
}

export interface Osc52Gate {
  /**
   * The user pressed a key or a mouse button in this terminal. [programOwned] is
   * [programOwnsTerminal] evaluated at that moment; only such actions open the window.
   */
  userActed: (programOwned: boolean, now?: number) => void
  /** Decoded text to put on the clipboard, or null when the write is refused. */
  accept: (payload: string, enabled: boolean, now?: number) => string | null
}

/**
 * Per-terminal gate for remote clipboard writes.
 *
 * A program's own "copy" (Codex / tmux / vim sending OSC 52) follows a key or mouse
 * action of the user, made *while that program already had the terminal*. So a
 * write is honoured only within [OSC52_USER_WINDOW_MS] of such an action.
 *
 * The "program already had the terminal" half is what makes default-on defensible.
 * A plain time window is not enough: pressing Enter on `cat file` or on a nested
 * `ssh` is itself a key press, and the hostile output arrives right after it. At a
 * shell prompt nothing owns the terminal, so that Enter opens no window — and the
 * output cannot qualify itself afterwards by switching modes, because the mode is
 * sampled at the key press, not at the write.
 *
 * Known limits: a copy sequence printed by a script at a plain shell prompt is
 * refused; and inside a program that owns the terminal (e.g. a pager showing a
 * hostile file) a key press does open the window.
 *
 * It replaces the old "once per second" limit, which silently dropped the second
 * of two quick copies while the program still reported success. The size cap stays.
 */
export function createOsc52Gate(): Osc52Gate {
  let lastUser = -Infinity
  return {
    userActed(programOwned, now = Date.now()) {
      if (programOwned) lastUser = now
    },
    accept(payload, enabled, now = Date.now()) {
      if (!enabled || payload.length > 65536) return null
      if (now - lastUser > OSC52_USER_WINDOW_MS) return null
      return decodeOsc52Payload(payload, 65536)
    }
  }
}
