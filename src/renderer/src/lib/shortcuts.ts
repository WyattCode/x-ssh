/**
 * The one list of keyboard shortcuts, rendered by ShortcutsDialog. Keeping it
 * here (rather than as markup) means the panel can't drift from what the app
 * actually binds — add a binding, add it here.
 *
 * "Mod" renders as Ctrl on Windows/Linux and ⌘ on macOS.
 *
 * Each item carries a `key` used to look up its (already-grouped) i18n
 * description and optional hint: `sck.<key>` and `sck.<key>Hint`.
 */
export interface Shortcut {
  keys: string
  /** i18n key suffix: `sck.<key>` for the description, `sck.<key>Hint` for the note. */
  key: string
}

export interface ShortcutGroup {
  id: string
  items: Shortcut[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: 'connect',
    items: [
      { keys: 'Mod+K', key: 'palette' },
      { keys: 'Mod+Shift+P', key: 'palette2' },
      { keys: 'Mod+T', key: 'newTab' },
      { keys: 'Mod+W', key: 'closeTab' },
      { keys: 'Ctrl+Tab', key: 'nextTab' },
      { keys: 'Ctrl+Shift+Tab', key: 'prevTab' },
      { keys: 'Mod+1 … Mod+8', key: 'jumpN' },
      { keys: 'Mod+9', key: 'jumpLast' }
    ]
  },
  {
    id: 'split',
    items: [
      { keys: 'Mod+Shift+D', key: 'split' },
      { keys: 'Mod+Shift+\\', key: 'splitCol' },
      { keys: 'Mod+Shift+O', key: 'focus' },
      { keys: 'Mod+Shift+W', key: 'closePane' }
    ]
  },
  {
    id: 'terminal',
    items: [
      { keys: 'Ctrl+C', key: 'copy' },
      { keys: 'Ctrl+V', key: 'paste' },
      { keys: 'Ctrl+Shift+C / Ctrl+Shift+V', key: 'ctrlCpv' },
      { keys: 'Ctrl+F', key: 'search' },
      { keys: 'Shift+PageUp / Shift+PageDown', key: 'scroll' },
      { keys: '右键', key: 'rightClick' }
    ]
  },
  {
    id: 'files',
    items: [
      { keys: 'Mod+Shift+E', key: 'sftp' },
      { keys: 'Mod+Shift+F', key: 'history' },
      { keys: 'Mod+,', key: 'settings' },
      { keys: 'Mod+/', key: 'shortcuts' }
    ]
  },
  {
    id: 'ui',
    items: [
      { keys: 'Mod+= / Mod+-', key: 'zoom' },
      { keys: 'Mod+0', key: 'resetZoom' },
      { keys: 'Ctrl+滚轮', key: 'wheel' }
    ]
  }
]

/** The app-global (non-terminal) actions that can be re-bound by the user. */
export type RebindableAction =
  | 'palette'
  | 'palette2'
  | 'newTab'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'split'
  | 'splitCol'
  | 'focus'
  | 'closePane'
  | 'sftp'
  | 'history'
  | 'settings'
  | 'shortcuts'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'

/** Default chords for the rebindable actions (used when not overridden). */
export const DEFAULT_BINDINGS: Record<RebindableAction, string> = {
  palette: 'Mod+K',
  palette2: 'Mod+Shift+P',
  newTab: 'Mod+T',
  closeTab: 'Mod+W',
  nextTab: 'Ctrl+Tab',
  prevTab: 'Ctrl+Shift+Tab',
  split: 'Mod+Shift+D',
  splitCol: 'Mod+Shift+\\',
  focus: 'Mod+Shift+O',
  closePane: 'Mod+Shift+W',
  sftp: 'Mod+Shift+E',
  history: 'Mod+Shift+F',
  settings: 'Mod+,',
  shortcuts: 'Mod+/',
  zoomIn: 'Mod+=',
  zoomOut: 'Mod+-',
  zoomReset: 'Mod+0'
}

export const REBINDABLE_ACTIONS: RebindableAction[] = Object.keys(
  DEFAULT_BINDINGS
) as RebindableAction[]

/** Parses a chord like "Mod+Shift+D" into its modifier mask + key. */
function parseChord(chord: string): { mods: number; key: string } {
  const parts = chord.split('+')
  let mods = 0
  let key = ''
  for (const raw of parts) {
    const p = raw.trim()
    if (p === 'Mod') {
      mods |= 1
    } else if (p === 'Ctrl') {
      mods |= 2
    } else if (p === 'Shift') {
      mods |= 4
    } else if (p === 'Alt') {
      mods |= 8
    } else {
      key = p
    }
  }
  return { mods, key }
}

/** True when the keyboard event matches the given chord exactly. */
export function chordMatches(e: KeyboardEvent, chord: string): boolean {
  const { mods, key } = parseChord(chord)
  const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
  const mod = mods & 1 ? (isMac ? e.metaKey : e.ctrlKey) || e.metaKey : false
  const ctrl = mods & 2 ? e.ctrlKey : false
  const shift = mods & 4 ? e.shiftKey : false
  const alt = mods & 8 ? e.altKey : false
  if (mods & 1 && !mod) return false
  if (mods & 2 && !ctrl) return false
  if (mods & 4 && !shift) return false
  if (mods & 8 && !alt) return false
  // Reject when extra modifiers (not declared) are held, so Mod+K doesn't
  // swallow Ctrl+Shift+K.
  const extras = Number(e.metaKey) + Number(e.ctrlKey) + Number(e.shiftKey) + Number(e.altKey)
  const declared = Number(Boolean(mods & 1)) + Number(Boolean(mods & 2)) + Number(Boolean(mods & 4)) + Number(Boolean(mods & 8))
  if (extras !== declared) return false
  if (!key) return true
  return (key === '\\' ? e.key === '\\' : e.key.toLowerCase() === key.toLowerCase())
}
