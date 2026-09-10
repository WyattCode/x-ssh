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
import { isMac } from '../composables/platform'

export interface Shortcut {
  keys: string
  /** i18n key suffix: `sck.<key>` for the description, `sck.<key>Hint` for the note. */
  key: string
}

export interface ShortcutGroup {
  id: string
  items: Shortcut[]
}

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
/** Windows/Linux defaults. Mod renders as Ctrl there. */
const BASE_BINDINGS: Record<RebindableAction, string> = {
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

/**
 * What macOS does differently. ⌘D / ⌘⇧D to split and ⌘] to walk panes are what
 * the terminals a Mac user already has do (iTerm2, and ⌘D in Terminal.app);
 * ⌥⌘→ / ⌥⌘← is the system-wide way to change tab, and using it here leaves the
 * last Ctrl chord in the app layer back to the shell, which is the rule the
 * rest of this app follows on macOS.
 *
 * Arrows rather than ⌘⇧] / ⌘⇧[ (which Safari and Chrome also accept): chords
 * are matched on e.key, and Shift turns "]" into "}", while the extra-modifier
 * check below rules out declaring the shifted character instead. Option+arrow
 * is safe where Option+letter is not — ⌥D reports e.key "∂".
 */
const MAC_BINDINGS: Partial<Record<RebindableAction, string>> = {
  split: 'Mod+D',
  splitCol: 'Mod+Shift+D',
  focus: 'Mod+]',
  nextTab: 'Mod+Alt+ArrowRight',
  prevTab: 'Mod+Alt+ArrowLeft'
}

export const DEFAULT_BINDINGS: Record<RebindableAction, string> = isMac
  ? { ...BASE_BINDINGS, ...MAC_BINDINGS }
  : BASE_BINDINGS

/**
 * The reference list shown in the Shortcuts panel. Rebindable rows read their
 * chord straight out of DEFAULT_BINDINGS so the panel cannot drift from what
 * the app binds; the terminal and zoom rows are not rebindable and differ by
 * platform, because on macOS the app-level modifier is ⌘ and every Ctrl combo
 * is left to the shell.
 */
const D = DEFAULT_BINDINGS

/** Terminal keys, which are hard-wired rather than rebindable. */
const TERMINAL_ITEMS: Shortcut[] = isMac
  ? [
      // ⌘C/⌘V are the Mac clipboard keys; Ctrl+C stays what it is in a shell.
      { keys: 'Mod+C', key: 'copyMac' },
      { keys: 'Mod+V', key: 'paste' },
      { keys: 'Ctrl+C', key: 'interrupt' },
      { keys: 'Mod+F', key: 'search' },
      { keys: 'Shift+PageUp / Shift+PageDown', key: 'scroll' },
      { keys: 'MouseRight', key: 'rightClick' }
    ]
  : [
      { keys: 'Ctrl+C', key: 'copy' },
      { keys: 'Ctrl+V', key: 'paste' },
      { keys: 'Ctrl+Shift+C / Ctrl+Shift+V', key: 'ctrlCpv' },
      { keys: 'Ctrl+F', key: 'search' },
      { keys: 'Shift+PageUp / Shift+PageDown', key: 'scroll' },
      { keys: 'MouseRight', key: 'rightClick' }
    ]

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: 'connect',
    items: [
      { keys: D.palette, key: 'palette' },
      { keys: D.palette2, key: 'palette2' },
      { keys: D.newTab, key: 'newTab' },
      { keys: D.closeTab, key: 'closeTab' },
      { keys: D.nextTab, key: 'nextTab' },
      { keys: D.prevTab, key: 'prevTab' },
      { keys: 'Mod+1 … Mod+8', key: 'jumpN' },
      { keys: 'Mod+9', key: 'jumpLast' }
    ]
  },
  {
    id: 'split',
    items: [
      { keys: D.split, key: 'split' },
      { keys: D.splitCol, key: 'splitCol' },
      { keys: D.focus, key: 'focus' },
      { keys: D.closePane, key: 'closePane' }
    ]
  },
  { id: 'terminal', items: TERMINAL_ITEMS },
  {
    id: 'files',
    items: [
      { keys: D.sftp, key: 'sftp' },
      { keys: D.history, key: 'history' },
      { keys: D.settings, key: 'settings' },
      { keys: D.shortcuts, key: 'shortcuts' }
    ]
  },
  {
    id: 'ui',
    items: [
      { keys: `${D.zoomIn} / ${D.zoomOut}`, key: 'zoom' },
      { keys: D.zoomReset, key: 'resetZoom' },
      // The wheel zoom takes the app-level modifier too: ⌘ on macOS, so that
      // Ctrl+wheel stays free for the system screen zoom.
      { keys: 'Mod+MouseWheel', key: 'wheel' }
    ]
  }
]

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

/**
 * Canonical, comparison-safe form of a chord for conflict detection. Normalizes
 * which modifier actually fires on this platform — on Windows/Linux `Mod` and
 * `Ctrl` both mean Ctrl, so `Mod+K` conflicts with `Ctrl+K`; on macOS `Mod`
 * means ⌘ and `Ctrl` stays distinct. Returns undefined for a bare key (no
 * modifier), which a recorded binding never produces.
 */
export function canonicalChord(chord: string, isMac: boolean): string | undefined {
  const { mods, key } = parseChord(chord)
  const modSet: string[] = []
  if (mods & 1) modSet.push(isMac ? 'Meta' : 'Ctrl') // Mod
  if (mods & 2) modSet.push('Ctrl')
  if (mods & 4) modSet.push('Shift')
  if (mods & 8) modSet.push('Alt')
  if (!modSet.length) return undefined
  return [...new Set(modSet)].sort().join('+') + '+' + key.toLowerCase()
}

/** True when the keyboard event matches the given chord exactly. */
export function chordMatches(e: KeyboardEvent, chord: string): boolean {
  const { mods, key } = parseChord(chord)
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
