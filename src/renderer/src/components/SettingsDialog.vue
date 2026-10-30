<script setup lang="ts">
import { formatFingerprint } from '../../../shared/hostKey'
import { ref, computed, watch, nextTick, reactive } from 'vue'
import { useSessions } from '../stores/sessions'
import Icon from './Icon.vue'
import {
  SHORTCUT_GROUPS,
  DEFAULT_BINDINGS,
  REBINDABLE_ACTIONS,
  canonicalChord,
  basePhysicalKey,
  type RebindableAction
} from '../lib/shortcuts'
import { splitShortcutChips } from '../lib/shortcutChips'
import { PRESETS } from '../lib/terminalThemes'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import { useTheme } from '../composables/theme'
import type { SettingsTab } from '../stores/sessions'
import type { KnownHostEntry } from '../../../shared/types'
import { isMac, isWin } from '../composables/platform'
import { isMac } from '../composables/platform'
import { isImeKey } from '../lib/ime'

const store = useSessions()
const { langPref, setLang, t } = useI18n()
const { pref: themePref, setPref: setThemePref, mode: themeMode } = useTheme()
const { toast } = useToast()
const { confirm } = useConfirm()

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: '', icon: 'settings' },
  { id: 'terminal', label: '', icon: 'terminal' },
  { id: 'connection', label: '', icon: 'server' },
  { id: 'security', label: '', icon: 'shield' },
  { id: 'keys', label: '', icon: 'keyboard' }
]

const modKey = isMac ? '⌘' : 'Ctrl'
const withMod = (t: string): string => t.split('Mod').join(modKey)

// Chip labels. macOS spells its modifiers as symbols, and DOM key names
// (ArrowRight…) would otherwise be shown to the user verbatim.
const MAC_MOD_SYMBOL: Record<string, string> = { Shift: '⇧', Alt: '⌥', Ctrl: '⌃' }
const KEY_LABEL: Record<string, string> = {
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓'
}
function chipLabel(part: string): string {
  if (part === 'Mod') return modKey
  // Pointer "keys" are words, not glyphs, so they go through i18n. Spelled out
  // as literals so the i18n linter can see them.
  if (part === 'MouseRight') return t('kbd.mouseRight')
  if (part === 'MouseWheel') return t('kbd.mouseWheel')
  if (isMac && MAC_MOD_SYMBOL[part]) return MAC_MOD_SYMBOL[part]
  return KEY_LABEL[part] ?? part
}

/** Splits a spec into chip groups and the separators between them:
 *  "Mod+1 … Mod+8" renders as [Ctrl][1] … [Ctrl][8]. */
function parts(keys: string): { chord?: string[]; sep?: string }[] {
  return splitShortcutChips(keys).map((piece) =>
    'sep' in piece
      ? { sep: piece.sep === 'or' ? t('kbd.or') : '…' }
      : { chord: piece.chord.map(chipLabel) }
  )
}

const groups = SHORTCUT_GROUPS
// Returns the translated note for a shortcut key, or '' when none exists.
function hintOf(key: string): string {
  const k = 'sck.' + key + 'Hint'
  const v = t(k)
  return v !== k ? v : ''
}

// ---- rebindable app shortcuts ----
const recording = ref<RebindableAction | null>(null)
const recCaptureEl = ref<HTMLElement>()
watch(recording, async (r) => {
  if (r) {
    await nextTick()
    recCaptureEl.value?.focus()
  }
})
// Maps a rebindable action to its i18n description key in the shortcut list.
const DESC_KEY: Record<RebindableAction, string> = {
  palette: 'palette',
  palette2: 'palette2',
  newTab: 'newTab',
  closeTab: 'closeTab',
  nextTab: 'nextTab',
  prevTab: 'prevTab',
  split: 'split',
  splitCol: 'splitCol',
  focus: 'focus',
  closePane: 'closePane',
  sftp: 'sftp',
  history: 'history',
  settings: 'settings',
  shortcuts: 'shortcuts',
  zoomIn: 'zoom',
  zoomOut: 'zoom',
  zoomReset: 'resetZoom'
}
function bindingOf(id: RebindableAction): string {
  return store.keybindings[id] ?? DEFAULT_BINDINGS[id]
}
function startRecord(id: RebindableAction): void {
  recording.value = id
}
/** Chords the app acts on regardless of the rebindable table: the number jump in
   *  App.vue, and the terminal's copy / paste / find. Recording one of these used
   *  to be accepted and then never fired, while the action's old binding was gone. */
const RESERVED_CHORDS = [
  ...Array.from({ length: 9 }, (_, i) => `Mod+${i + 1}`),
  'Mod+c',
  'Mod+v',
  'Mod+f'
]
function isReservedChord(chord: string): boolean {
  const canon = canonicalChord(chord, isMac)
  return !!canon && RESERVED_CHORDS.some((r) => canonicalChord(r, isMac) === canon)
}
function recordChord(e: KeyboardEvent, id: RebindableAction): void {
  // The chord being recorded must not also run (Ctrl+1 jumping to tab 1).
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    recording.value = null
    return
  }
  const mods = []
  // Mod is ⌘ on macOS and Ctrl elsewhere. On a Mac the two must stay distinct:
  // folding Ctrl into Mod stored a Ctrl chord as a ⌘ one, so the keys the user
  // had just pressed then did nothing. Off macOS the old reading is kept, where
  // Mod already matches either.
  if (isMac ? e.metaKey : e.ctrlKey || e.metaKey) mods.push('Mod')
  if (isMac && e.ctrlKey) mods.push('Ctrl')
  if (e.shiftKey) mods.push('Shift')
  if (e.altKey) mods.push('Alt')
  // A chord has to end in a real key. Ctrl+Shift alone used to store
  // "Mod+Shift+Shift" — nothing can ever match that, and it had already
  // replaced the action's working default.
  if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'AltGraph') return
  if (!mods.length) return // require at least one modifier to avoid eating typing
  let key = e.key
  if (key === ' ') key = 'Space'
  // macOS composes Option+letter into a glyph — ⌥D arrives as "∂" — which would
  // be stored and shown to the user in place of the letter. Take the physical
  // key instead; chordMatches knows to fall back to it the same way.
  const physical = basePhysicalKey(e)
  if (isMac && e.altKey && physical) key = physical
  const chord = [...mods, key].join('+')
  // Reject a collision with another action's effective binding (a user override
  // on another action, or a default we haven't overridden). Same action is fine.
  const owner = conflictOwner(chord, id)
  if (owner) {
    toast(t('set.sc.conflict', { other: t('sck.' + DESC_KEY[owner]) }), 'error')
    return
  }
  if (isReservedChord(chord)) {
    toast(t('set.sc.reserved'), 'error')
    return
  }
  const next = { ...store.keybindings, [id]: chord }
  store.keybindings = next
  void store.saveSetting('keybindings', next)
  recording.value = null
}
/** Returns another rebindable action whose effective chord collides, if any. */
function conflictOwner(chord: string, id: RebindableAction): RebindableAction | undefined {
  for (const action of REBINDABLE_ACTIONS) {
    if (action === id) continue
    if (canonicalChord(chord, isMac) && canonicalChord(chord, isMac) === canonicalChord(bindingOf(action), isMac)) {
      return action
    }
  }
  return undefined
}
async function resetBinding(id: RebindableAction): Promise<void> {
  const next = { ...store.keybindings }
  delete next[id]
  store.keybindings = next
  void store.saveSetting('keybindings', next)
}
const dialogEl = ref<HTMLElement>()

// Focus the dialog on open so Esc (bound below) works without a prior click.
watch(
  () => store.settingsOpen,
  (o) => {
    if (o) nextTick(() => dialogEl.value?.focus())
  }
)
// Load the connection audit log each time the security tab is shown —
// including opening 设置 straight onto it.
watch(
  () => store.settingsOpen && store.settingsTab === 'security',
  (show) => {
    if (show) {
      void loadConnLog()
      void loadHelloStatus()
    }
  }
)

async function pickEditor(): Promise<void> {
  const p = await window.api.pickExecutable()
  if (p) {
    await window.api.settings.set('externalEditor', p)
    store.externalEditor = p
  }
}
async function clearEditor(): Promise<void> {
  await window.api.settings.set('externalEditor', '')
  store.externalEditor = null
}

// ---- per-extension default openers ----
const openerForm = reactive({ ext: '', program: '' })
async function upsertOpener(): Promise<void> {
  const ext = openerForm.ext.trim().toLowerCase().replace(/^\./, '')
  if (!ext) return
  const next = { ...store.fileOpeners }
  if (openerForm.program) next[ext] = openerForm.program
  else delete next[ext]
  store.fileOpeners = next
  await window.api.settings.set('fileOpeners', next)
  openerForm.ext = ''
  openerForm.program = ''
}
async function setOpenerProgram(ext: string): Promise<void> {
  const p = await window.api.pickExecutable()
  if (!p) return
  const next = { ...store.fileOpeners, [ext]: p }
  store.fileOpeners = next
  await window.api.settings.set('fileOpeners', next)
}
async function removeOpener(ext: string): Promise<void> {
  const next = { ...store.fileOpeners }
  delete next[ext]
  store.fileOpeners = next
  await window.api.settings.set('fileOpeners', next)
}

// ---- custom accent color ('' = theme default) ----
function onAccent(e: Event): void {
  store.accentColor = (e.target as HTMLInputElement).value
  void store.saveSetting('accentColor', store.accentColor)
}
async function clearAccent(): Promise<void> {
  store.accentColor = ''
  void store.saveSetting('accentColor', '')
}

/** Swatch shown when no custom accent is set — must match the theme default
 *  in global.css (--accent is #6ea8fe dark / #2f6fed light). */
const accentSwatch = computed(() =>
  store.accentColor || (themeMode.value === 'light' ? '#2f6fed' : '#6ea8fe')
)

const cursorOptions = computed(() => [
  { v: 'bar', label: t('set.term.cursorBar') },
  { v: 'block', label: t('set.term.cursorBlock') },
  { v: 'underline', label: t('set.term.cursorUnderline') }
] as const)

// Common monospace fonts to pick from; empty value = app default stack.
const fontOptions = [
  'Cascadia Code',
  'Cascadia Mono',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'Consolas',
  'Courier New',
  'Menlo',
  'Monaco',
  'Ubuntu Mono',
  'SF Mono'
]
// Include a previously-saved custom font so the select reflects the real value.
const fontList = computed(() => {
  const f = store.terminalFontFamily
  return f && !fontOptions.includes(f) ? [f, ...fontOptions] : fontOptions
})

function setCursor(c: 'bar' | 'block' | 'underline'): void {
  store.terminalCursor = c
  void store.saveSetting('terminalCursor', c)
}
function onFont(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  store.terminalFontFamily = v
  void store.saveSetting('terminalFontFamily', v)
}
function onTheme(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  store.terminalTheme = v
  void store.saveSetting('terminalTheme', v)
}
function toggleConfirmPaste(): void {
  store.confirmPaste = !store.confirmPaste
  void store.saveSetting('confirmPaste', store.confirmPaste)
}
function toggleSanitizePaste(): void {
  store.sanitizePaste = !store.sanitizePaste
  void store.saveSetting('sanitizePaste', store.sanitizePaste)
}
function toggleCopyOnSelect(): void {
  store.copyOnSelect = !store.copyOnSelect
  void store.saveSetting('copyOnSelect', store.copyOnSelect)
}
function toggleMiddleClickPaste(): void {
  store.middleClickPaste = !store.middleClickPaste
  void store.saveSetting('middleClickPaste', store.middleClickPaste)
}
function toggleRightClickPaste(): void {
  store.rightClickPaste = !store.rightClickPaste
  void store.saveSetting('rightClickPaste', store.rightClickPaste)
}
function onKeepalive(e: Event): void {
  // Clearing mid-edit must not persist a default (0 = keepalive off) and must
  // not get the box forced back to the stored value before retyping.
  const raw = (e.target as HTMLInputElement).value
  if (raw.trim() === '') return
  const n = Math.max(0, Math.min(600, parseInt(raw, 10) || 0))
  store.keepaliveSec = n
  void store.saveSetting('keepaliveSec', n)
}
function onTimeout(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  if (raw.trim() === '') return
  const n = Math.max(1, Math.min(300, parseInt(raw, 10) || 20))
  store.connectTimeoutSec = n
  void store.saveSetting('connectTimeoutSec', n)
}
function onRetries(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  if (raw.trim() === '') return
  const n = Math.max(0, Math.min(30, parseInt(raw, 10) || 0))
  store.connectRetries = n
  void store.saveSetting('connectRetries', n)
}
function onConcurrency(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  if (raw.trim() === '') return
  const n = Math.max(1, Math.min(32, parseInt(raw, 10) || 4))
  store.transferConcurrency = n
  void store.saveSetting('transferConcurrency', n)
}
function toggleAutoDetectOs(): void {
  store.autoDetectOs = !store.autoDetectOs
  void store.saveSetting('autoDetectOs', store.autoDetectOs)
}
function toggleVerifyChecksums(): void {
  store.verifyChecksums = !store.verifyChecksums
  void store.saveSetting('verifyChecksums', store.verifyChecksums)
}
function onRate(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  if (raw.trim() === '') return
  const n = Math.max(0, Math.min(131072, parseInt(raw, 10) || 0))
  store.transferRateKbps = n
  void store.saveSetting('transferRateKbps', n)
}
function toggleShell(): void {
  store.shellIntegration = !store.shellIntegration
  void store.saveSetting('shellIntegration', store.shellIntegration)
}
function toggleRestore(): void {
  store.restoreTabs = !store.restoreTabs
  void store.saveSetting('restoreTabs', store.restoreTabs)
}
function toggleAutoReconnect(): void {
  store.autoReconnect = !store.autoReconnect
  void store.saveSetting('autoReconnect', store.autoReconnect)
}
function toggleRestoreConnect(): void {
  store.restoreConnect = !store.restoreConnect
  void store.saveSetting('restoreConnect', store.restoreConnect)
}
function toggleRestoreCwd(): void {
  store.restoreCwd = !store.restoreCwd
  void store.saveSetting('restoreCwd', store.restoreCwd)
}
function toggleNotifications(): void {
  store.notifications = !store.notifications
  void store.saveSetting('notifications', store.notifications)
}
function toggleNotifySound(): void {
  store.notifySound = !store.notifySound
  void store.saveSetting('notifySound', store.notifySound)
}
function toggleConfirmClose(): void {
  store.confirmClose = !store.confirmClose
  void store.saveSetting('confirmClose', store.confirmClose)
}
function toggleMinimizeToTray(): void {
  store.minimizeToTray = !store.minimizeToTray
  void store.saveSetting('minimizeToTray', store.minimizeToTray)
}
function toggleConnectionMultiplex(): void {
  store.connectionMultiplex = !store.connectionMultiplex
  void store.saveSetting('connectionMultiplex', store.connectionMultiplex)
}
function toggleTmuxOnConnect(): void {
  store.tmuxOnConnect = !store.tmuxOnConnect
  void store.saveSetting('tmuxOnConnect', store.tmuxOnConnect)
}
function onTmuxSessionName(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  store.tmuxSessionName = v
  void store.saveSetting('tmuxSessionName', v)
}
const globalHotkey = reactive({ error: '' })
// The example has to be an Electron accelerator, and macOS spells it
// differently — a Mac user shown "Ctrl+Alt+X" would reasonably type "⌘⌥X",
// which Electron does not accept.
const globalShowHidePh = computed(() =>
  isMac ? t('set.gen.globalShowHidePhMac') : t('set.gen.globalShowHidePh')
)
const globalShowHideDesc = computed(() =>
  isMac ? t('set.gen.globalShowHideDescMac') : t('set.gen.globalShowHideDesc')
)
async function onGlobalShowHide(e: Event): Promise<void> {
  const v = (e.target as HTMLInputElement).value
  const r = await store.setGlobalShowHide(v)
  globalHotkey.error = r.ok
    ? ''
    : (r.error ?? t('set.gen.globalShortcutErr'))
}

// ---- Update check (GitHub releases feed) ----
const updateState = reactive({
  checking: false,
  fresh: false,
  latest: '',
  url: '',
  name: '',
  notes: '',
  error: ''
})
async function checkForUpdates(): Promise<void> {
  if (updateState.checking) return
  updateState.checking = true
  updateState.error = ''
  const r = await window.api.checkUpdate()
  updateState.checking = false
  if (!r.ok) {
    updateState.error = r.error ?? t('set.gen.updateErr')
    return
  }
  if (r.fresh) {
    updateState.fresh = true
    updateState.latest = r.latest ?? ''
  } else {
    updateState.fresh = false
    updateState.latest = r.latest ?? ''
    updateState.name = r.name ?? ''
    updateState.url = r.url ?? ''
    updateState.notes = r.notes ?? ''
  }
}
function openUpdatePage(): void {
  if (updateState.url) void window.api.openExternal(updateState.url)
}

// ---- command snippets ----
const snippetForm = reactive({
  open: false,
  id: '',
  title: '',
  text: '',
  confirm: false,
  group: '',
  hostId: '',
  defaultVars: ''
})
function startNewSnippet(): void {
  snippetForm.open = true
  snippetForm.id = ''
  snippetForm.title = ''
  snippetForm.text = ''
  snippetForm.confirm = false
  snippetForm.group = ''
  snippetForm.hostId = ''
  snippetForm.defaultVars = ''
}
function editSnippet(s: { id: string; title: string; text: string; confirm?: boolean; group?: string; hostId?: string; defaultVars?: Record<string, string> }): void {
  snippetForm.open = true
  snippetForm.id = s.id
  snippetForm.title = s.title
  snippetForm.text = s.text
  snippetForm.confirm = !!s.confirm
  snippetForm.group = s.group ?? ''
  snippetForm.hostId = s.hostId ?? ''
  snippetForm.defaultVars = Object.entries(s.defaultVars ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}
function parseDefaultVars(s: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of s.split(/\n/)) {
    const idx = line.indexOf('=')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    if (key) out[key] = line.slice(idx + 1)
  }
  return Object.keys(out).length ? out : undefined
}
async function saveSnippet(): Promise<void> {
  if (!snippetForm.title.trim() || !snippetForm.text.trim()) return
  await store.saveSnippet({
    id: snippetForm.id || `snip-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    title: snippetForm.title.trim(),
    text: snippetForm.text,
    confirm: snippetForm.confirm || undefined,
    group: snippetForm.group.trim() || undefined,
    defaultVars: parseDefaultVars(snippetForm.defaultVars),
    hostId: snippetForm.hostId || undefined
  })
  snippetForm.open = false
}
async function deleteSnippet(id: string): Promise<void> {
  // Deleting a snippet is one-way; confirm first, naming it so a misclick on
  // the wrong row is obvious. Fall back to the id if the row is already gone.
  const title = store.snippets.find((s) => s.id === id)?.title ?? id
  const ok = await confirm(t('set.gen.snipDeleteConfirm', { title }), { danger: true })
  if (!ok) return
  await store.deleteSnippet(id)
}
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 54)
}
function hostLabel(id: string): string {
  return store.hosts.find((h) => h.id === id)?.label ?? id
}

// ---- known hosts / SSH config ----
async function forgetKnownHost(k: KnownHostEntry): Promise<void> {
  // Forgetting a trusted key is destructive: the next connect re-prompts (and
  // a changed key would otherwise be silently accepted). Confirm first.
  const ok = await confirm(t('set.sec.forgetConfirm', { host: `${k.host}:${k.port}` }), { danger: true })
  if (!ok) return
  await window.api.knownHosts.forget(k.host, k.port)
  await store.loadKnownHosts()
}
/** Human age of a trusted host key ('' for unknown/too young to matter). */
function keyAge(firstSeen?: number): string {
  if (!firstSeen) return ''
  const days = Math.floor((Date.now() - firstSeen) / 86400000)
  if (days < 1) return '0d'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}
/** A host key trusted for more than a year is flagged — stale keys should be
 *  re-verified in case the host was rebuilt / re-keyed. */
function keyStale(firstSeen?: number): boolean {
  return !!firstSeen && Date.now() - firstSeen > 365 * 86400000
}
// ---- connection audit log ----
const connLog = ref<{ at: number; event: string; host: string; port: number; username: string; detail?: string; bytes?: number }[]>([])
async function loadConnLog(): Promise<void> {
  connLog.value = await window.api.connLog.list()
}
async function clearConnLog(): Promise<void> {
  // One-way wipe of the audit trail; everything else destructive here confirms
  // first, and a misclick on a danger button shouldn't erase the record.
  const ok = await confirm(t('set.sec.connLogClearConfirm'))
  if (!ok) return
  await window.api.connLog.clear()
  connLog.value = []
}
const eventLabel = (e: string): string =>
  e === 'connect'
    ? t('set.sec.connConnect')
    : e === 'disconnect'
      ? t('set.sec.connDisconnect')
      : e === 'transfer'
        ? t('set.sec.connTransfer')
        : e === 'forward'
          ? t('set.sec.connForward')
          : t('set.sec.connError')
const connTime = (at: number): string => new Date(at).toLocaleString()
function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}
async function importSshConfig(): Promise<void> {
  await window.api.hosts.importSshConfig()
  await store.loadHosts()
  await store.loadKnownHosts()
}
async function exportHostsJson(): Promise<void> {
  const r = await window.api.hosts.exportJson()
  if (!r.ok && !r.canceled) toast(r.error ?? t('set.sec.exportFail'), 'error')
  else if (r.ok) toast(`${t('set.sec.exported')} ${store.hosts.length} ${t('set.sec.hosts')}`, 'success')
}
async function importHostsJson(): Promise<void> {
  const res = await confirm(t('set.sec.importJsonConfirm'))
  if (!res) return
  const r = await window.api.hosts.importJson()
  if (!r.ok && !r.canceled) toast(r.error ?? t('set.sec.importFail'), 'error')
  else if (r.ok) {
    await store.loadHosts()
    toast(`${t('set.sec.imported')} ${r.count ?? 0} ${t('set.sec.hosts')}`, 'success')
  }
}
async function exportSshConfig(): Promise<void> {
  const r = await window.api.hosts.exportSshConfig()
  if (!r.ok && !r.canceled) toast(r.error ?? t('set.sec.exportFail'), 'error')
  else if (r.ok) toast(t('set.sec.exportedSsh'), 'success')
}

// ---- full data backup (hosts + secrets + snippets + snapshots + history) ----
const backupBusy = ref(false)
async function exportAllData(): Promise<void> {
  const r = await window.api.data.exportAll()
  if (!r.ok && !r.canceled) toast(r.error ?? t('set.sec.exportFail'), 'error')
  else if (r.ok) toast(t('set.sec.exportedAll'), 'success')
}
async function importAllData(): Promise<void> {
  const res = await confirm(t('set.sec.importAllConfirm'))
  if (!res) return
  const r = await window.api.data.importAll()
  if (!r.ok && !r.canceled) toast(r.error ?? t('set.sec.importFail'), 'error')
  else if (r.ok) {
    await Promise.all([store.loadHosts(), store.loadSnippets(), store.loadSnapshots(), store.loadTransferHistory()])
    toast(t('set.sec.importedAll'), 'success')
  }
}
function toggleAutoBackup(): void {
  store.autoBackup = !store.autoBackup
  void store.saveSetting('autoBackup', store.autoBackup)
  void store.rescheduleBackup()
}
async function pickBackupDir(): Promise<void> {
  const dir = await window.api.pickDirectory()
  if (dir) {
    store.autoBackupDir = dir
    void store.saveSetting('autoBackupDir', dir)
    void store.rescheduleBackup()
  }
}
function onBackupHours(e: Event): void {
  // Clearing must not snap back to 24h; values beyond the box's max were
  // persisted verbatim before (5000h ran the backup… never).
  const raw = (e.target as HTMLInputElement).value
  if (raw.trim() === '') return
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return
  store.autoBackupEveryHours = Math.min(720, Math.max(1, n))
  void store.saveSetting('autoBackupEveryHours', store.autoBackupEveryHours)
  void store.rescheduleBackup()
}
async function backupNow(): Promise<void> {
  backupBusy.value = true
  const r = await window.api.data.backupNow()
  backupBusy.value = false
  toast(r.ok ? t('set.sec.backupDone') : (r.error ?? t('set.sec.backupFail')), r.ok ? 'success' : 'error')
}

// ---- App master-lock ----
const lockNewPass = ref('')
const lockBusy = ref(false)
const helloSupported = ref(false)
const helloEnabled = ref(false)
const helloAvailable = ref<'available' | 'unavailable' | 'unsupported'>('unsupported')
const helloBusy = ref(false)
async function loadHelloStatus(): Promise<void> {
  if (!isWin) return
  try {
    const s = await window.api.userVerify.status()
    helloSupported.value = s.supported
    helloEnabled.value = s.enabled
    helloAvailable.value = s.available
  } catch { /* ignore */ }
}
async function toggleHello(): Promise<void> {
  if (!helloSupported.value || helloAvailable.value === 'unavailable') return
  helloBusy.value = true
  try {
    const s = await window.api.userVerify.setEnabled(!helloEnabled.value)
    helloEnabled.value = s.enabled
    helloAvailable.value = s.available
  } finally { helloBusy.value = false }
}
async function testHello(): Promise<void> {
  helloBusy.value = true
  try {
    const r = await window.api.userVerify.test()
    if (r.outcome === 'verified') toast(t('hello.testOk'), 'success')
    else toast(t('hello.testFail'), 'error')
  } finally { helloBusy.value = false }
}
const currentPass = ref('')
async function saveMasterLock(): Promise<void> {
  if (!lockNewPass.value) {
    toast(t('lock.passReq'), 'error')
    return
  }
  lockBusy.value = true
  try {
    const r = await store.setMasterPassphrase(lockNewPass.value)
    if (r.ok) {
      lockNewPass.value = ''
      toast(t('lock.saved'), 'success')
    } else {
      toast(r.error ?? t('lock.saveFail'), 'error')
    }
  } finally {
    lockBusy.value = false
  }
}
async function unlockNow(): Promise<void> {
  if (lockBusy.value) return
  if (!currentPass.value) {
    toast(t('lock.passReq'), 'error')
    return
  }
  lockBusy.value = true
  try {
    const ok = await store.unlockApp(currentPass.value)
    if (ok) {
      currentPass.value = ''
      await store.loadHosts()
      store.connectPendingAfterUnlock()
      toast(t('lock.unlocked'), 'success')
    } else {
      toast(t('lock.wrong'), 'error')
    }
  } finally {
    lockBusy.value = false
  }
}
async function lockApp(): Promise<void> {
  await store.lockNow()
  toast(t('lock.lockedNow'), 'success')
}
async function disableMasterLock(): Promise<void> {
  if (lockBusy.value) return
  if (!currentPass.value) {
    toast(t('lock.passReq'), 'error')
    return
  }
  lockBusy.value = true
  try {
    const ok = await store.disableMasterLock(currentPass.value)
    if (ok) {
      currentPass.value = ''
      toast(t('lock.disabled'), 'success')
    } else {
      toast(t('lock.wrong'), 'error')
    }
  } finally {
    lockBusy.value = false
  }
}
async function resetMasterLock(): Promise<void> {
  if (lockBusy.value) return
  // Reset is verification-gated: enter the passphrase to confirm intent, so a
  // casual user can't wipe the lock with one unguarded click.
  if (!currentPass.value) {
    toast(t('lock.passReq'), 'error')
    return
  }
  // Busy is held across the confirm too, so a double-click can't stack two
  // confirmation dialogs (and two resets) on top of each other.
  lockBusy.value = true
  try {
    const res = await confirm(t('lock.resetConfirm'))
    if (!res) return
    const ok = await store.resetMasterLock(currentPass.value)
    if (ok) {
      currentPass.value = ''
      await store.loadHosts()
      store.connectPendingAfterUnlock()
      toast(t('lock.resetDone'), 'success')
    } else {
      toast(t('lock.wrong'), 'error')
    }
  } finally {
    lockBusy.value = false
  }
}
/** Enter in either master-lock password field. Bound without `.prevent` so the
 *  Enter that commits an IME candidate is left to the input method (see lib/ime). */
function onLockPassEnter(e: KeyboardEvent): void {
  if (isImeKey(e)) return
  e.preventDefault()
  if (!store.lockEnabled) {
    void saveMasterLock()
    return
  }
  if (store.lockLocked) void unlockNow()
  // Enabled and already unlocked: Enter alone does nothing — disabling or
  // resetting the lock needs an explicit click.
}

</script>

<template>
  <!-- 设置: a sidebar page in the 连接 page's language — title, pill tabs, then
       grouped cards of rows (name + one line on the left, the control on the right). -->
  <div v-if="store.settingsOpen" class="settings">
    <div class="page-col">
      <header class="page-head">
        <h1>{{ t('set.title') }}</h1>
      </header>
      <nav class="stabs">
        <button
          v-for="tabItem in TABS"
          :key="tabItem.id"
          :class="{ on: store.settingsTab === tabItem.id }"
          @click="store.settingsTab = tabItem.id"
        >
          <Icon :name="tabItem.icon" :size="14" />{{ t('tab.' + tabItem.id) }}
        </button>
      </nav>

      <div ref="dialogEl" class="content" tabindex="-1">
        <div class="inner">
          <!-- ================= 通用 ================= -->
          <template v-if="store.settingsTab === 'general'">
            <section class="group">
              <h3>{{ t('set.grp.appearance') }}</h3>
              <div class="card">
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.lang') }}</span>
                    <span class="r-desc">{{ t('set.gen.langDesc') }}</span>
                  </div>
                  <div class="seg">
                    <button :class="{ on: langPref === 'system' }" @click="setLang('system')">{{ t('lang.system') }}</button>
                    <button :class="{ on: langPref === 'zh' }" lang="zh-CN" @click="setLang('zh')">{{ t('lang.zh') }}</button>
                    <button :class="{ on: langPref === 'zh-TW' }" lang="zh-TW" @click="setLang('zh-TW')">{{ t('lang.zhTW') }}</button>
                    <button :class="{ on: langPref === 'en' }" lang="en" @click="setLang('en')">{{ t('lang.en') }}</button>
                  </div>
                </div>
                <div class="row">
                  <div class="r-text"><span class="r-title">{{ t('theme.label') }}</span></div>
                  <div class="seg">
                    <button :class="{ on: themePref === 'system' }" @click="setThemePref('system')">{{ t('theme.system') }}</button>
                    <button :class="{ on: themePref === 'light' }" @click="setThemePref('light')">{{ t('theme.light') }}</button>
                    <button :class="{ on: themePref === 'dark' }" @click="setThemePref('dark')">{{ t('theme.dark') }}</button>
                  </div>
                </div>
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.sidebar') }}</span>
                    <span class="r-desc">{{ t('set.gen.sidebarDesc') }}</span>
                  </div>
                  <button class="btn sm" @click="store.resetSidebar()">{{ t('set.gen.sidebarReset') }}</button>
                </div>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.grp.files') }}</h3>
              <div class="card">
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.editor') }}</span>
                    <span class="r-desc">{{ t('set.gen.editorDesc') }}</span>
                  </div>
                  <span class="value" :class="{ dim: !store.externalEditor }" :title="store.externalEditor || ''">
                    {{ store.externalEditor || t('set.gen.systemDefault') }}
                  </span>
                  <button class="btn sm" @click="pickEditor">{{ t('set.gen.pickEditor') }}</button>
                  <button v-if="store.externalEditor" class="btn sm" @click="clearEditor">{{ t('set.gen.restoreDefault') }}</button>
                </div>
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.openers') }}</span>
                    <span class="r-desc">{{ t('set.gen.openersDesc') }}</span>
                  </div>
                </div>
                <div v-for="(prog, ext) in store.fileOpeners" :key="ext" class="row list">
                  <span class="chip mono">.{{ ext }}</span>
                  <span class="mono grow ellipsis" :title="prog">{{ prog }}</span>
                  <button class="btn sm" @click="setOpenerProgram(ext)">{{ t('set.gen.openerSet') }}</button>
                  <button class="icon-x" :title="t('set.gen.delete')" @click="removeOpener(ext)"><Icon name="trash" :size="14" /></button>
                </div>
                <div class="row form-row">
                  <input v-model="openerForm.ext" class="box mono ext-in" :placeholder="t('set.gen.openerExt')" spellcheck="false" />
                  <input v-model="openerForm.program" class="box mono grow" :placeholder="t('set.gen.openerProg')" spellcheck="false" />
                  <button class="btn sm" @click="upsertOpener">{{ t('set.gen.openerAdd') }}</button>
                </div>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.gen.startup') }}</h3>
              <div class="card">
                <label class="row toggle" @click="toggleRestore">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.restoreTabs') }}</span>
                    <span class="r-desc">{{ t('set.gen.restoreTabsDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.restoreTabs }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleRestoreConnect">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.restoreConnect') }}</span>
                    <span class="r-desc">{{ t('set.gen.restoreConnectDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.restoreConnect }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleRestoreCwd">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.restoreCwd') }}</span>
                    <span class="r-desc">{{ t('set.gen.restoreCwdDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.restoreCwd }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleMinimizeToTray">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.minimizeToTray') }}</span>
                    <span class="r-desc">{{ t('set.gen.minimizeToTrayDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.minimizeToTray }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleConnectionMultiplex">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.connectionMultiplex') }}</span>
                    <span class="r-desc">{{ t('set.gen.connectionMultiplexDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.connectionMultiplex }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleTmuxOnConnect">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.tmuxOnConnect') }}</span>
                    <span class="r-desc">{{ t('set.gen.tmuxOnConnectDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.tmuxOnConnect }"><i /></span>
                </label>
                <div v-if="store.tmuxOnConnect" class="row">
                  <div class="r-text"><span class="r-title">{{ t('set.gen.tmuxSessionName') }}</span></div>
                  <input
                    class="box text-in"
                    :value="store.tmuxSessionName"
                    :placeholder="t('set.gen.tmuxSessionNamePh')"
                    spellcheck="false"
                    @change="onTmuxSessionName"
                    @keyup.enter="onTmuxSessionName"
                  />
                </div>
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.gen.globalShowHide') }}</span>
                    <span v-if="globalHotkey.error" class="r-desc err">{{ globalHotkey.error }}</span>
                    <span v-else class="r-desc">{{ globalShowHideDesc }}</span>
                  </div>
                  <input
                    class="box text-in mono"
                    :value="store.globalShowHide"
                    :placeholder="globalShowHidePh"
                    spellcheck="false"
                    @change="onGlobalShowHide"
                    @keyup.enter="onGlobalShowHide"
                  />
                </div>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.gen.snippets') }}</h3>
              <p class="g-desc">{{ t('set.gen.snippetsDesc') }}</p>
              <div class="card">
                <div v-for="s in store.snippets" :key="s.id" class="row list">
                  <div class="r-text">
                    <span class="r-title">{{ s.title }}<span v-if="s.group" class="faint"> · {{ s.group }}</span></span>
                    <span class="r-desc mono ellipsis">{{ oneLine(s.text) }}</span>
                  </div>
                  <span v-if="s.hostId" class="chip">{{ hostLabel(s.hostId) }}</span>
                  <button class="btn sm" @click="editSnippet(s)">{{ t('set.gen.edit') }}</button>
                  <button class="icon-x" :title="t('set.gen.delete')" @click="deleteSnippet(s.id)"><Icon name="trash" :size="14" /></button>
                </div>
                <div v-if="snippetForm.open" class="sub">
                  <input v-model="snippetForm.title" class="box" :placeholder="t('set.gen.snipName')" spellcheck="false" />
                  <textarea v-model="snippetForm.text" class="box mono ta" :placeholder="t('set.gen.snipPlaceholder')" spellcheck="false" />
                  <div class="sub-grid">
                    <input v-model="snippetForm.group" class="box grow" :placeholder="t('set.gen.snipGroup')" spellcheck="false" />
                    <div class="select-box grow">
                      <select v-model="snippetForm.hostId" :aria-label="t('set.gen.snipHostScope')">
                        <option value="">{{ t('set.gen.snipHostAll') }}</option>
                        <option v-for="h in store.hosts" :key="h.id" :value="h.id">{{ h.label }}</option>
                      </select>
                      <Icon name="chevron-down" :size="14" class="caret" />
                    </div>
                  </div>
                  <span class="sub-label">{{ t('set.gen.snipDefaultVars') }}</span>
                  <textarea v-model="snippetForm.defaultVars" class="box mono ta short" :placeholder="t('set.gen.snipDefaultVarsPh')" spellcheck="false" />
                  <div class="sub-foot">
                    <label class="check">
                      <input v-model="snippetForm.confirm" type="checkbox" class="switch-input" />
                      <span>{{ t('set.gen.snipConfirm') }}</span>
                    </label>
                    <span class="spacer" />
                    <button class="btn sm" @click="snippetForm.open = false">{{ t('set.gen.cancel') }}</button>
                    <button class="btn sm btn-primary" :disabled="!snippetForm.title.trim() || !snippetForm.text.trim()" @click="saveSnippet">{{ t('set.gen.save') }}</button>
                  </div>
                </div>
                <button v-else class="row add-row" @click="startNewSnippet"><Icon name="plus" :size="14" />{{ t('set.gen.newSnippet') }}</button>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.gen.update') }}</h3>
              <p class="g-desc">{{ t('set.gen.updateDesc') }}</p>
              <div class="card">
                <div class="row">
                  <div class="r-text">
                    <span class="r-title" :class="{ faint: !updateState.latest }">
                      <template v-if="updateState.fresh">{{ t('set.gen.upToDate', { v: updateState.latest }) }}</template>
                      <template v-else-if="updateState.latest">{{ t('set.gen.updateAvail', { v: updateState.latest }) }}</template>
                      <template v-else>{{ t('set.gen.updateUnknown') }}</template>
                    </span>
                    <span v-if="updateState.error" class="r-desc err">{{ updateState.error }}</span>
                  </div>
                  <button class="btn sm" :disabled="updateState.checking" @click="checkForUpdates">
                    {{ updateState.checking ? t('set.gen.updateChecking') : t('set.gen.updateCheck') }}
                  </button>
                  <button v-if="updateState.url" class="btn sm btn-tinted" @click="openUpdatePage">{{ t('set.gen.updateOpen') }}</button>
                </div>
                <div v-if="updateState.notes && !updateState.fresh" class="row notes">{{ updateState.notes }}</div>
              </div>
            </section>
          </template>

          <!-- ================= 终端 ================= -->
          <template v-else-if="store.settingsTab === 'terminal'">
            <section class="group">
              <h3>{{ t('set.term.appearance') }}</h3>
              <div class="card">
                <div class="row">
                  <div class="r-text"><span class="r-title">{{ t('set.term.font') }}</span></div>
                  <div class="select-box">
                    <select :value="store.terminalFontFamily" @change="onFont">
                      <option value="">{{ t('set.term.systemDefault') }}</option>
                      <option v-for="f in fontList" :key="f" :value="f">{{ f }}</option>
                    </select>
                    <Icon name="chevron-down" :size="14" class="caret" />
                  </div>
                </div>
                <div class="row">
                  <div class="r-text"><span class="r-title">{{ t('set.term.cursor') }}</span></div>
                  <div class="seg">
                    <button v-for="o in cursorOptions" :key="o.v" :class="{ on: store.terminalCursor === o.v }" @click="setCursor(o.v)">
                      {{ o.label }}
                    </button>
                  </div>
                </div>
                <div class="row">
                  <div class="r-text"><span class="r-title">{{ t('set.term.theme') }}</span></div>
                  <div class="select-box">
                    <select :value="store.terminalTheme" @change="onTheme">
                      <option value="">{{ t('set.term.themeSystem') }}</option>
                      <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                    <Icon name="chevron-down" :size="14" class="caret" />
                  </div>
                </div>
                <div class="row">
                  <div class="r-text"><span class="r-title">{{ t('set.term.accent') }}</span></div>
                  <button v-if="store.accentColor" class="btn sm" @click="clearAccent">{{ t('set.term.accentReset') }}</button>
                  <input type="color" class="color-in" :value="accentSwatch" @input="onAccent" />
                </div>
              </div>
              <p class="foot-note">{{ t('set.term.fontHint', { keys: `${modKey}+= / ${modKey}+-` }) }}</p>
            </section>

            <section class="group">
              <h3>{{ t('set.term.safety') }}</h3>
              <div class="card">
                <label class="row toggle" @click="toggleConfirmPaste">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.term.confirmPaste') }}</span>
                    <span class="r-desc">{{ t('set.term.confirmPasteDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.confirmPaste }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleSanitizePaste">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.term.sanitizePaste') }}</span>
                    <span class="r-desc">{{ t('set.term.sanitizePasteDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.sanitizePaste }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleCopyOnSelect">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.term.copyOnSelect') }}</span>
                    <span class="r-desc">{{ t('set.term.copyOnSelectDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.copyOnSelect }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleMiddleClickPaste">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.term.middleClickPaste') }}</span>
                    <span class="r-desc">{{ t('set.term.middleClickPasteDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.middleClickPaste }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleRightClickPaste">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.term.rightClickPaste') }}</span>
                    <span class="r-desc">{{ t('set.term.rightClickPasteDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.rightClickPaste }"><i /></span>
                </label>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.term.integration') }}</h3>
              <div class="card">
                <label class="row toggle" @click="toggleShell">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.term.cwdSync') }}</span>
                    <span class="r-desc">{{ t('set.term.cwdSyncDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.shellIntegration }"><i /></span>
                </label>
              </div>
            </section>
          </template>

          <!-- ================= 连接 ================= -->
          <template v-else-if="store.settingsTab === 'connection'">
            <section class="group">
              <h3>{{ t('set.conn.keepalive') }}</h3>
              <div class="card">
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.interval') }}</span>
                    <span class="r-desc">{{ t('set.conn.keepaliveDesc') }}</span>
                  </div>
                  <span class="num">
                    <input class="box mono" type="number" min="0" max="600" :value="store.keepaliveSec" @input="onKeepalive" />
                    <span class="unit">{{ t('set.conn.seconds') }}</span>
                  </span>
                </div>
                <label class="row toggle" @click="toggleAutoDetectOs">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.autoDetectOs') }}</span>
                    <span class="r-desc">{{ t('set.conn.autoDetectOsDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.autoDetectOs }"><i /></span>
                </label>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.conn.timeout') }}</h3>
              <div class="card">
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.timeoutVal') }}</span>
                    <span class="r-desc">{{ t('set.conn.timeoutDesc') }}</span>
                  </div>
                  <span class="num">
                    <input class="box mono" type="number" min="1" max="300" :value="store.connectTimeoutSec" @input="onTimeout" />
                    <span class="unit">{{ t('set.conn.seconds') }}</span>
                  </span>
                </div>
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.retriesVal') }}</span>
                    <span class="r-desc">{{ t('set.conn.retriesDesc') }}</span>
                  </div>
                  <span class="num">
                    <input class="box mono" type="number" min="0" max="30" :value="store.connectRetries" @input="onRetries" />
                    <span class="unit">{{ t('set.conn.times') }}</span>
                  </span>
                </div>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.conn.xfer') }}</h3>
              <div class="card">
                <div class="row">
                  <div class="r-text"><span class="r-title">{{ t('set.conn.xferConc') }}</span></div>
                  <span class="num">
                    <input class="box mono" type="number" min="1" max="32" :value="store.transferConcurrency" @input="onConcurrency" />
                    <span class="unit">{{ t('set.conn.files') }}</span>
                  </span>
                </div>
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.xferRate') }}</span>
                    <span class="r-desc">{{ t('set.conn.xferRateDesc') }}</span>
                  </div>
                  <span class="num">
                    <input class="box mono" type="number" min="0" max="131072" :value="store.transferRateKbps" @input="onRate" />
                    <span class="unit">{{ t('set.conn.kbps') }}</span>
                  </span>
                </div>
                <label class="row toggle" @click="toggleVerifyChecksums">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.verifyChecksums') }}</span>
                    <span class="r-desc">{{ t('set.conn.verifyChecksumsDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.verifyChecksums }"><i /></span>
                </label>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.conn.drop') }}</h3>
              <div class="card">
                <label class="row toggle" @click="toggleAutoReconnect">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.autoReconnect') }}</span>
                    <span class="r-desc">{{ t('set.conn.autoReconnectDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.autoReconnect }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleNotifications">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.notify') }}</span>
                    <span class="r-desc">{{ t('set.conn.notifyDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.notifications }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleNotifySound">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.notifySound') }}</span>
                    <span class="r-desc">{{ t('set.conn.notifySoundDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.notifySound }"><i /></span>
                </label>
                <label class="row toggle" @click="toggleConfirmClose">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.conn.confirmClose') }}</span>
                    <span class="r-desc">{{ t('set.conn.confirmCloseDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.confirmClose }"><i /></span>
                </label>
              </div>
            </section>
          </template>

          <!-- ================= 安全 ================= -->
          <template v-else-if="store.settingsTab === 'security'">
            <section class="group">
              <h3>{{ t('lock.title') }}</h3>
              <p class="g-desc">{{ t('lock.desc') }}</p>
              <div class="card">
                <template v-if="store.lockEnabled">
                  <label class="row">
                    <div class="r-text"><span class="r-title">{{ t('lock.current') }}</span></div>
                    <input v-model="currentPass" type="password" class="box text-in" :placeholder="t('lock.placeholder')" @keydown.enter="onLockPassEnter" />
                  </label>
                  <div class="row actions-row">
                    <button v-if="store.lockLocked" class="btn sm btn-primary" :disabled="lockBusy" @click="unlockNow">{{ t('lock.unlock') }}</button>
                    <button class="btn sm" :disabled="lockBusy" @click="lockApp">{{ t('lock.lockNow') }}</button>
                    <button class="btn sm" :disabled="lockBusy" @click="disableMasterLock">{{ t('lock.disable') }}</button>
                    <span class="spacer" />
                    <button class="btn sm btn-danger" :disabled="lockBusy" @click="resetMasterLock">{{ t('lock.reset') }}</button>
                  </div>
                </template>
                <label v-else class="row">
                  <div class="r-text"><span class="r-title">{{ t('lock.new') }}</span></div>
                  <input v-model="lockNewPass" type="password" class="box text-in" :placeholder="t('lock.placeholder')" @keydown.enter="onLockPassEnter" />
                  <button class="btn sm btn-primary" :disabled="lockBusy" @click="saveMasterLock">{{ t('lock.save') }}</button>
                </label>
              </div>
              <p class="foot-note">{{ t('lock.setHint') }}</p>
            </section>

            <section v-if="isWin && helloSupported" class="group">
              <h3>{{ t('hello.title') }}</h3>
              <p class="g-desc">{{ t('hello.desc') }}</p>
              <div class="card">
                <label
                  class="row toggle"
                  :class="{ disabled: helloAvailable === 'unavailable' || helloBusy }"
                  @click="toggleHello"
                >
                  <div class="r-text">
                    <span class="r-title">{{ t('hello.toggle') }}</span>
                    <span v-if="helloAvailable === 'unavailable'" class="r-desc">{{ t('hello.unavailable') }}</span>
                  </div>
                  <span class="switch" :class="{ on: helloEnabled }"><i /></span>
                </label>
                <div class="row actions-row">
                  <button class="btn sm" :disabled="helloBusy || helloAvailable === 'unavailable'" @click="testHello">{{ t('hello.test') }}</button>
                </div>
              </div>
            </section>
            <section class="group">
              <h3>{{ t('set.sec.backup') }}</h3>
              <div class="card">
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.sec.hostsJson') }}</span>
                    <span class="r-desc">{{ t('set.sec.backupDesc') }}</span>
                  </div>
                  <button class="btn sm" @click="exportHostsJson">{{ t('set.sec.export') }}</button>
                  <button class="btn sm" @click="importHostsJson">{{ t('set.sec.restore') }}</button>
                </div>
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.sec.fullBackup') }}</span>
                    <span class="r-desc">{{ t('set.sec.fullBackupDesc') }}</span>
                  </div>
                  <button class="btn sm" @click="exportAllData">{{ t('set.sec.exportAll') }}</button>
                  <button class="btn sm" @click="importAllData">{{ t('set.sec.importAll') }}</button>
                </div>
                <label class="row toggle" @click="toggleAutoBackup">
                  <div class="r-text">
                    <span class="r-title">{{ t('set.sec.autoBackup') }}</span>
                    <span class="r-desc">{{ t('set.sec.autoBackupDesc') }}</span>
                  </div>
                  <span class="switch" :class="{ on: store.autoBackup }"><i /></span>
                </label>
                <template v-if="store.autoBackup">
                  <div class="row">
                    <div class="r-text"><span class="r-title">{{ t('set.sec.backupDir') }}</span></div>
                    <span class="value" :class="{ dim: !store.autoBackupDir }" :title="store.autoBackupDir || ''">{{ store.autoBackupDir || t('set.sec.backupDirNone') }}</span>
                    <button class="btn sm" @click="pickBackupDir">{{ t('host.browse') }}</button>
                  </div>
                  <div class="row">
                    <div class="r-text"><span class="r-title">{{ t('set.sec.backupEvery') }}</span></div>
                    <span class="num">
                      <input :value="store.autoBackupEveryHours" class="box mono" type="number" min="1" max="720" @change="onBackupHours" />
                      <span class="unit">{{ t('set.sec.hours') }}</span>
                    </span>
                    <button class="btn sm" :disabled="backupBusy" @click="backupNow">{{ t('set.sec.backupNow') }}</button>
                  </div>
                </template>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.sec.sshConfig') }}</h3>
              <div class="card">
                <div class="row">
                  <div class="r-text">
                    <span class="r-title">~/.ssh/config</span>
                    <span class="r-desc">{{ t('set.sec.sshConfigDesc') }}</span>
                  </div>
                  <button class="btn sm" @click="importSshConfig">{{ t('set.sec.importShort') }}</button>
                  <button class="btn sm" @click="exportSshConfig">{{ t('set.sec.exportShort') }}</button>
                </div>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.sec.known') }}</h3>
              <p class="g-desc">{{ t('set.sec.knownDesc') }}</p>
              <div class="card">
                <div v-for="k in store.knownHosts" :key="`${k.host}:${k.port}`" class="row list">
                  <div class="r-text">
                    <span class="r-title mono">{{ k.host }}:{{ k.port }}</span>
                    <span
                      v-for="(fp, i) in (k.fingerprints?.length ? k.fingerprints : [k.fingerprint])"
                      :key="i"
                      class="r-desc mono ellipsis"
                      :title="formatFingerprint(fp)"
                    >{{ formatFingerprint(fp) }}</span>
                  </div>
                  <span
                    v-if="keyAge(k.firstSeen)"
                    class="chip"
                    :class="{ warn: keyStale(k.firstSeen) }"
                    :title="keyStale(k.firstSeen) ? t('set.sec.keyStaleTip') : t('set.sec.keyAge')"
                  >{{ keyAge(k.firstSeen) }}</span>
                  <button class="icon-x" :title="t('set.sec.delete')" @click="forgetKnownHost(k)"><Icon name="trash" :size="14" /></button>
                </div>
                <div v-if="!store.knownHosts.length" class="row empty">{{ t('set.sec.empty') }}</div>
              </div>
            </section>

            <section class="group">
              <h3>{{ t('set.sec.connLog') }}</h3>
              <p class="g-desc">{{ t('set.sec.connLogDesc') }}</p>
              <div class="card">
                <div v-for="(l, i) in connLog" :key="i" class="row log">
                  <span class="log-time">{{ connTime(l.at) }}</span>
                  <span class="log-event" :class="l.event">{{ eventLabel(l.event) }}</span>
                  <span class="mono grow ellipsis">{{ l.username }}@{{ l.host }}:{{ l.port }}</span>
                  <span v-if="l.detail" class="mono faint ellipsis log-detail">{{ l.detail }}<template v-if="l.bytes != null"> · {{ fmtBytes(l.bytes) }}</template></span>
                </div>
                <div v-if="!connLog.length" class="row empty">{{ t('set.sec.connLogEmpty') }}</div>
                <div v-else class="row actions-row">
                  <span class="spacer" />
                  <button class="btn sm btn-danger" @click="clearConnLog">{{ t('set.sec.connLogClear') }}</button>
                </div>
              </div>
            </section>
          </template>

          <!-- ================= 快捷键 ================= -->
          <template v-else>
            <section class="group">
              <h3>{{ t('set.sc.custom') }}</h3>
              <p class="g-desc">{{ t('set.sc.customDesc') }}</p>
              <div class="card">
                <div v-for="id in REBINDABLE_ACTIONS" :key="id" class="row sc">
                  <div class="r-text"><span class="r-title">{{ t('sck.' + DESC_KEY[id]) }}</span></div>
                  <template v-if="recording !== id">
                    <span class="keys">
                      <template v-for="(part, pi) in parts(bindingOf(id))" :key="pi">
                        <span v-if="part.sep" class="sep">{{ part.sep }}</span>
                        <span v-for="(k, ki) in part.chord || []" :key="ki" class="kbd">{{ k }}</span>
                      </template>
                    </span>
                    <button v-if="store.keybindings[id]" class="btn sm" @click="resetBinding(id)">{{ t('set.sc.reset') }}</button>
                    <button class="btn sm" @click="startRecord(id)">{{ t('set.sc.rebind') }}</button>
                  </template>
                  <template v-else>
                    <span class="kbd rec">{{ t('set.sc.recording') }}</span>
                    <button class="btn sm" @click="recording = null">{{ t('set.sc.cancel') }}</button>
                  </template>
                </div>
              </div>
              <div v-if="recording" ref="recCaptureEl" class="rec-capture" tabindex="-1" @keydown="recordChord($event, recording)" @mousedown="recording = null"></div>
            </section>

            <section v-for="g in groups" :key="g.id" class="group">
              <h3>{{ t('group.' + g.id) }}</h3>
              <div class="card">
                <div v-for="item in g.items" :key="item.keys" class="row sc">
                  <div class="r-text">
                    <span class="r-title">{{ t('sck.' + item.key) }}</span>
                    <span v-if="hintOf(item.key)" class="r-desc">{{ withMod(hintOf(item.key)) }}</span>
                  </div>
                  <span class="keys">
                    <template v-for="(part, pi) in parts(item.keys)" :key="pi">
                      <span v-if="part.sep" class="sep">{{ part.sep }}</span>
                      <span v-for="(k, ki) in part.chord || []" :key="ki" class="kbd">{{ k }}</span>
                    </template>
                  </span>
                </div>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Same page frame as 连接 / 端口转发 / SFTP; content as grouped cards of rows. */
.settings {
  display: flex;
  justify-content: center;
  height: 100%;
  padding: 24px 36px 0;
  background: var(--bg);
}
.page-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1320px;
  min-height: 0;
}

/* Tabs: the 连接 page's pill tabs. */
.stabs {
  flex: none;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.stabs button {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.stabs button:hover {
  background: var(--hover);
  color: var(--text);
}
.stabs button.on {
  color: var(--text);
  background: var(--selected);
}
.stabs button.on :deep(svg) {
  color: var(--accent);
}

.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  outline: none;
  /* Room for the scrollbar without shifting the column. */
  margin-right: -12px;
  padding-right: 12px;
}
/* Full width of the page column, like 连接 / SFTP / 端口转发: the cards'
   right edge lines up with the title row's on every page. */
.inner {
  container-type: inline-size;
  padding: 4px 0 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ---- Groups & rows ---- */
.group h3 {
  margin: 0 0 8px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-faint);
}
.g-desc,
.foot-note {
  margin: -2px 4px 10px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-faint);
}
.foot-note {
  margin: 8px 4px 0;
}
.card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 10px 16px;
  text-align: left;
  font-size: 13px;
  color: var(--text);
}
.row + .row,
.row + .sub,
.sub + .row {
  border-top: 1px solid var(--border);
}
.r-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-right: 12px;
}
.r-title {
  font-size: 13.5px;
  color: var(--text);
}
.r-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-faint);
}
.r-desc.solo {
  font-size: 12.5px;
  color: var(--text-dim);
}
.err {
  color: var(--danger) !important;
}
.faint {
  color: var(--text-faint);
}
.mono {
  font-family: var(--font-mono);
}
.grow {
  flex: 1;
  min-width: 0;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.row.toggle {
  cursor: pointer;
  transition: background 0.16s var(--ease);
}
.row.toggle:hover {
  background: var(--hover);
}
.row.list {
  min-height: 48px;
}
.row.empty {
  justify-content: center;
  min-height: 56px;
  font-size: 12.5px;
  color: var(--text-faint);
}
.row.notes {
  display: block;
  max-height: 160px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  color: var(--text-dim);
}
.row.actions-row {
  min-height: 48px;
}

/* ---- Controls ---- */
.btn.sm {
  height: 30px;
  padding: 0 11px;
  font-size: 12.5px;
}
/* Segmented control: compact rounded rectangle, thumb concentric (8 − 2). */
.seg {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 2px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.seg button {
  height: 24px;
  padding: 0 12px;
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--text-dim);
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.seg button:hover {
  color: var(--text);
}
.seg button.on {
  color: var(--text);
  background: var(--thumb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
/* Switch */
.switch {
  flex: none;
  position: relative;
  width: 36px;
  height: 22px;
  border-radius: var(--r-pill);
  background: var(--border-strong);
  transition: background 0.18s var(--ease);
}
.switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  transition: transform 0.18s var(--ease);
}
.switch.on {
  background: var(--accent);
}
.switch.on i {
  transform: translateX(14px);
}
/* Boxed fields */
.box {
  height: 30px;
  padding: 0 10px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.16s var(--ease);
}
.box:focus {
  border-color: var(--accent);
}
.text-in {
  flex: none;
  width: 240px;
}
.ext-in {
  flex: none;
  width: 96px;
}
.ta {
  height: auto;
  min-height: 76px;
  padding: 8px 10px;
  line-height: 1.5;
  resize: vertical;
}
.ta.short {
  min-height: 54px;
}
.num {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.num input {
  width: 76px;
  text-align: right;
}
.num input::-webkit-outer-spin-button,
.num input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
/* Fixed width so the number fields line up down the card whatever the unit. */
/* Short units in a fixed column, so the number fields line up. */
.unit {
  width: 52px;
  font-size: 12px;
  color: var(--text-faint);
}
.select-box {
  position: relative;
  flex: none;
  width: 240px;
  height: 30px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition: border-color 0.16s var(--ease);
}
.select-box:focus-within {
  border-color: var(--accent);
}
.select-box.grow {
  flex: 1;
  width: auto;
}
.select-box select {
  width: 100%;
  height: 100%;
  padding: 0 28px 0 10px;
  font-size: 12.5px;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
  appearance: none;
  cursor: pointer;
}
.select-box .caret {
  position: absolute;
  top: 50%;
  right: 9px;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
}
.color-in {
  flex: none;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: var(--r-pill);
  background: none;
  cursor: pointer;
}
.color-in::-webkit-color-swatch-wrapper {
  padding: 3px;
}
.color-in::-webkit-color-swatch {
  border: none;
  border-radius: var(--r-pill);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
}
.value {
  flex: 0 1 auto;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
}
.value.dim {
  font-family: inherit;
  color: var(--text-faint);
}
.chip {
  flex: none;
  padding: 0 9px;
  font-size: 12px;
  line-height: 22px;
  color: var(--text-dim);
  background: var(--hover);
  border-radius: var(--r-pill);
  white-space: nowrap;
}
.chip.mono {
  color: var(--accent);
  background: var(--accent-soft);
}
.chip.warn {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.icon-x {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-pill);
  color: var(--text-faint);
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.icon-x:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.form-row {
  background: color-mix(in srgb, var(--bg) 55%, var(--bg-elev));
}
.add-row {
  justify-content: center;
  gap: 6px;
  min-height: 46px;
  font-size: 13px;
  color: var(--accent);
  transition: background 0.16s var(--ease);
}
.add-row:hover {
  background: var(--accent-soft);
}

/* Editing area opened inside a card (snippet form). */
.sub {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: color-mix(in srgb, var(--bg) 55%, var(--bg-elev));
}
.sub-grid {
  display: flex;
  gap: 8px;
}
.sub-label {
  margin: 2px 2px 0;
  font-size: 12px;
  color: var(--text-faint);
}
.sub-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-dim);
  cursor: pointer;
}
.switch-input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}

/* Connection log */
.row.log {
  min-height: 40px;
  padding-top: 7px;
  padding-bottom: 7px;
  font-size: 12.5px;
}
.log-time {
  flex: none;
  width: 132px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.log-event {
  flex: none;
  min-width: 64px;
  padding: 0 8px;
  font-size: 11.5px;
  line-height: 20px;
  text-align: center;
  border-radius: var(--r-pill);
  color: var(--text-dim);
  background: var(--hover);
}
.log-event.connect {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 13%, transparent);
}
.log-event.error {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.log-event.transfer,
.log-event.forward {
  color: var(--accent);
  background: var(--accent-soft);
}
.log-detail {
  max-width: 240px;
  font-size: 12px;
}

/* Shortcuts */
.row.sc {
  min-height: 46px;
}
.keys {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 320px;
}
.sep {
  padding: 0 3px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.kbd.rec {
  padding: 0 10px;
  color: var(--accent);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}
/* Invisible full-window catcher while recording a chord. */
.rec-capture {
  position: fixed;
  inset: 0;
  z-index: 130;
  outline: none;
}

/* The column narrows with the window and the sidebar, so ask the column. */
@container (max-width: 640px) {
  .text-in,
  .select-box {
    width: 180px;
  }
  .value {
    max-width: 160px;
  }
}
</style>
