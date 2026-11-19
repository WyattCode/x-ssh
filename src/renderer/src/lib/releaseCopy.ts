/**
 * Selecting text in the terminal copies it the moment the mouse is released —
 * no modifier, no setting, same on Windows and macOS.
 *
 * Copying on release (not on every selection change while dragging) means one
 * clipboard write per gesture instead of one per cell the pointer crosses.
 *
 * "Did this gesture select something?" is answered by whether the selection
 * *changed* between press and release (xterm's onSelectionChange fires for the
 * clear and the new range alike, and a double-click selects at the press itself).
 * A plain click inside a program that owns the mouse (tmux, vim) leaves an old
 * highlight untouched, so it changes nothing and copies nothing — it must not
 * overwrite whatever the user copied elsewhere in the meantime.
 */
export interface ReleaseCopyDeps {
  /** The terminal's current selection text ('' when there is none). */
  getSelection: () => string
  /** Put text on the system clipboard; may throw. */
  write: (text: string) => void
  /** Called when [write] threw. */
  onError: () => void
}

export interface ReleaseCopy {
  /** Pointer pressed on the terminal (call before the terminal handles the press). */
  down: () => void
  /** The terminal's selection changed (any reason). */
  selectionChanged: () => void
  /**
   * A press started somewhere else: forget a gesture whose release never arrived,
   * so that unrelated release cannot copy the terminal's selection.
   */
  cancel: () => void
  /** Pointer released (anywhere). Returns true if text was copied. */
  up: () => boolean
}

export function createReleaseCopy(deps: ReleaseCopyDeps): ReleaseCopy {
  let pressed = false
  let changed = false
  return {
    down() {
      pressed = true
      changed = false
    },
    selectionChanged() {
      if (pressed) changed = true
    },
    cancel() {
      pressed = false
      changed = false
    },
    up() {
      // A release that did not start on the terminal must not copy its old selection.
      if (!pressed) return false
      const didChange = changed
      pressed = false
      changed = false
      if (!didChange) return false
      const text = deps.getSelection()
      if (!text) return false
      try {
        deps.write(text)
      } catch {
        deps.onError()
        return false
      }
      return true
    }
  }
}
