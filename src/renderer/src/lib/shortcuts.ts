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
