/**
 * Every settings key the renderer is allowed to write through `settings:set`.
 *
 * The settings file holds more than UI preferences: `masterLock` (the app lock's
 * scrypt hash), `connectionLog`, `sessionHistory`, and the persisted `snapshots`
 * all live in the same flat map. `settings:set` used to accept any key at all,
 * so a compromised renderer (or any bug that built a key from user data) could
 * overwrite the lock record — and the in-memory `MasterLock` would not notice
 * until the next launch, when the lock would simply be gone.
 *
 * Keys written only by main are deliberately absent: the renderer has no reason
 * to set them, and listing them would reopen the same hole.
 */
export const RENDERER_SETTABLE_KEYS = new Set([
  // Appearance / locale
  'accentColor',
  'fontSize',
  'lang',
  'terminalCursor',
  'terminalFontFamily',
  'terminalTheme',
  'zoom',
  // Connection behaviour
  'autoReconnect',
  'connectRetries',
  'connectTimeoutSec',
  'connectionMultiplex',
  'keepaliveSec',
  'restoreConnect',
  'restoreCwd',
  'restoreTabs',
  'shellIntegration',
  'tmuxOnConnect',
  'tmuxSessionName',
  // Terminal interaction
  'confirmPaste',
  'copyOnSelect',
  'keybindings',
  'middleClickPaste',
  'rightClickPaste',
  'sanitizePaste',
  // Transfers
  'autoBackup',
  'autoBackupDir',
  'autoBackupEveryHours',
  'downloadQueue',
  'sftpBookmarks',
  'sftpRecent',
  'sftpShowHidden',
  'sftpTransferHistory',
  'sftpWidth',
  'transferConcurrency',
  'transferQueue',
  'transferRateKbps',
  'verifyChecksums',
  'autoDetectOs',
  // Files / editor
  'externalEditor',
  'fileOpeners',
  // Misc UI
  'hostsSort',
  'hostsView',
  'sidebarCollapsed',
  'sidebarWidth',
  'termSidebarHidden',
  'confirmClose',
  'globalShowHideAccel',
  'minimizeToTray',
  'notifications',
  'notifySound',
  'openTabs',
  'snapshots',
])

/** Keys main writes but the renderer must never be able to set. */
export const MAIN_ONLY_KEYS = new Set([
  'connectionLog',
  'masterLock',
  // Background OS detection's back-off list (main/index.ts detectMissingOs).
  'osDetectFailed',
  'sessionHistory',
  // Written by main's theme:set, which validates the value and pins the
  // native theme to it in the same step.
  'theme',
  'windowBounds',
  // Windows Hello key-use gate (main/userVerify.ts). Toggled only through the
  // userVerify:setEnabled IPC, which validates the platform first.
  'winHelloKeyGate',
])

/**
 * True when `key` may be written over `settings:set`. Unknown keys are refused
 * rather than allowed: a new preference has to be added here on purpose, which
 * is the whole point of the list.
 */
export function isRendererSettableKey(key: unknown): key is string {
  return typeof key === 'string' && RENDERER_SETTABLE_KEYS.has(key)
}
