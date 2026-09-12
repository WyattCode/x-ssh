<script setup lang="ts">
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
import type { SettingsTab } from '../stores/sessions'
import type { KnownHostEntry } from '../../../shared/types'
import { isMac } from '../composables/platform'

const store = useSessions()
const { lang, setLang, t } = useI18n()
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
function recordChord(e: KeyboardEvent, id: RebindableAction): void {
  e.preventDefault()
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
// Load the connection audit log each time the security tab is shown.
watch(
  () => store.settingsTab,
  (tab) => {
    if (tab === 'security') void loadConnLog()
  },
  { immediate: false }
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
  const n = Math.max(0, Math.min(600, parseInt((e.target as HTMLInputElement).value, 10) || 0))
  store.keepaliveSec = n
  void store.saveSetting('keepaliveSec', n)
}
function onTimeout(e: Event): void {
  const n = Math.max(1, Math.min(300, parseInt((e.target as HTMLInputElement).value, 10) || 20))
  store.connectTimeoutSec = n
  void store.saveSetting('connectTimeoutSec', n)
}
function onRetries(e: Event): void {
  const n = Math.max(0, Math.min(30, parseInt((e.target as HTMLInputElement).value, 10) || 0))
  store.connectRetries = n
  void store.saveSetting('connectRetries', n)
}
function onConcurrency(e: Event): void {
  const n = Math.max(1, Math.min(32, parseInt((e.target as HTMLInputElement).value, 10) || 4))
  store.transferConcurrency = n
  void store.saveSetting('transferConcurrency', n)
}
function toggleVerifyChecksums(): void {
  store.verifyChecksums = !store.verifyChecksums
  void store.saveSetting('verifyChecksums', store.verifyChecksums)
}
function onRate(e: Event): void {
  const n = Math.max(0, Math.min(131072, parseInt((e.target as HTMLInputElement).value, 10) || 0))
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
  const v = Number((e.target as HTMLInputElement).value)
  store.autoBackupEveryHours = v > 0 ? v : 24
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
  if (!currentPass.value) return
  const ok = await store.unlockApp(currentPass.value)
  if (ok) {
    currentPass.value = ''
    await store.loadHosts()
    store.connectPendingAfterUnlock()
    toast(t('lock.unlocked'), 'success')
  } else {
    toast(t('lock.wrong'), 'error')
  }
}
async function lockApp(): Promise<void> {
  await store.lockNow()
  toast(t('lock.lockedNow'), 'success')
}
async function disableMasterLock(): Promise<void> {
  if (!currentPass.value) {
    toast(t('lock.passReq'), 'error')
    return
  }
  const ok = await store.disableMasterLock(currentPass.value)
  if (ok) {
    currentPass.value = ''
    toast(t('lock.disabled'), 'success')
  } else {
    toast(t('lock.wrong'), 'error')
  }
}
async function resetMasterLock(): Promise<void> {
  // Reset is verification-gated: enter the passphrase to confirm intent, so a
  // casual user can't wipe the lock with one unguarded click.
  if (!currentPass.value) {
    toast(t('lock.passReq'), 'error')
    return
  }
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
}

</script>

<template>
  <div v-if="store.settingsOpen" class="overlay" @mousedown.self="store.toggleSettings(false)">
    <div ref="dialogEl" class="dialog" tabindex="-1" @keydown.esc="store.toggleSettings(false)">
      <div class="head">
        <span>{{ t('set.title') }}</span>
        <button class="x" :title="t('set.closeTip')" @click="store.toggleSettings(false)"><Icon name="close" /></button>
      </div>

      <div class="body">
        <nav class="nav">
          <button
            v-for="tabItem in TABS"
            :key="tabItem.id"
            class="nav-item"
            :class="{ on: store.settingsTab === tabItem.id }"
            @click="store.settingsTab = tabItem.id"
          >
            <Icon :name="tabItem.icon" :size="15" />
            <span>{{ t('tab.' + tabItem.id) }}</span>
          </button>
        </nav>

        <div class="pane">
          <!-- 通用 -->
          <template v-if="store.settingsTab === 'general'">
            <div class="section">
              <div class="label">{{ t('set.gen.lang') }}</div>
              <div class="seg">
                <button :class="{ on: lang === 'zh' }" @click="setLang('zh')">{{ t('lang.zh') }}</button>
                <button :class="{ on: lang === 'en' }" @click="setLang('en')">{{ t('lang.en') }}</button>
              </div>
              <p class="desc">{{ t('set.gen.langDesc') }}</p>
            </div>
            <div class="section">
              <div class="label">{{ t('set.gen.editor') }}</div>
              <p class="desc">{{ t('set.gen.editorDesc') }}</p>
              <div class="editor-row">
                <span class="path" :class="{ dim: !store.externalEditor }">
                  {{ store.externalEditor || t('set.gen.systemDefault') }}
                </span>
                <button class="ghost" @click="pickEditor">{{ t('set.gen.pickEditor') }}</button>
                <button v-if="store.externalEditor" class="ghost" @click="clearEditor">{{ t('set.gen.restoreDefault') }}</button>
              </div>
            </div>
            <div class="section">
              <div class="label">{{ t('set.gen.openers') }}</div>
              <p class="desc">{{ t('set.gen.openersDesc') }}</p>
              <div class="opener-form">
                <input v-model="openerForm.ext" class="opener-ext" :placeholder="t('set.gen.openerExt')" spellcheck="false" />
                <input v-model="openerForm.program" class="opener-prog" :placeholder="t('set.gen.openerProg')" spellcheck="false" />
                <button class="ghost" @click="upsertOpener">{{ t('set.gen.openerAdd') }}</button>
              </div>
              <div v-for="(prog, ext) in store.fileOpeners" :key="ext" class="opener-row">
                <span class="opener-ext-tag">.{{ ext }}</span>
                <span class="opener-prog-tag" :title="prog">{{ prog }}</span>
                <button class="ghost" @click="setOpenerProgram(ext)">{{ t('set.gen.openerSet') }}</button>
                <button class="ghost" @click="removeOpener(ext)">{{ t('set.gen.delete') }}</button>
              </div>
            </div>
            <div class="section">
              <div class="label">{{ t('set.gen.startup') }}</div>
              <label class="toggle-row" @click="toggleRestore">
                <span>
                  <span class="fname">{{ t('set.gen.restoreTabs') }}</span>
                  <span class="sub">{{ t('set.gen.restoreTabsDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.restoreTabs }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleRestoreConnect">
                <span>
                  <span class="fname">{{ t('set.gen.restoreConnect') }}</span>
                  <span class="sub">{{ t('set.gen.restoreConnectDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.restoreConnect }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleRestoreCwd">
                <span>
                  <span class="fname">{{ t('set.gen.restoreCwd') }}</span>
                  <span class="sub">{{ t('set.gen.restoreCwdDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.restoreCwd }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleMinimizeToTray">
                <span>
                  <span class="fname">{{ t('set.gen.minimizeToTray') }}</span>
                  <span class="sub">{{ t('set.gen.minimizeToTrayDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.minimizeToTray }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleConnectionMultiplex">
                <span>
                  <span class="fname">{{ t('set.gen.connectionMultiplex') }}</span>
                  <span class="sub">{{ t('set.gen.connectionMultiplexDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.connectionMultiplex }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleTmuxOnConnect">
                <span>
                  <span class="fname">{{ t('set.gen.tmuxOnConnect') }}</span>
                  <span class="sub">{{ t('set.gen.tmuxOnConnectDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.tmuxOnConnect }"><i /></span>
              </label>
              <label v-if="store.tmuxOnConnect" class="toggle-row">
                <span>
                  <span class="fname">{{ t('set.gen.tmuxSessionName') }}</span>
                  <input
                    class="text"
                    :value="store.tmuxSessionName"
                    :placeholder="t('set.gen.tmuxSessionNamePh')"
                    spellcheck="false"
                    @change="onTmuxSessionName"
                    @keyup.enter="onTmuxSessionName"
                  />
                </span>
              </label>
              <label class="toggle-row">
                <span>
                  <span class="fname">{{ t('set.gen.globalShowHide') }}</span>
                  <input
                    class="text"
                    :value="store.globalShowHide"
                    :placeholder="t('set.gen.globalShowHidePh')"
                    spellcheck="false"
                    @change="onGlobalShowHide"
                    @keyup.enter="onGlobalShowHide"
                  />
                  <span v-if="globalHotkey.error" class="sub err">{{ globalHotkey.error }}</span>
                  <span v-else class="sub">{{ t('set.gen.globalShowHideDesc') }}</span>
                </span>
              </label>
            </div>
            <div class="section">
              <div class="label">{{ t('set.gen.snippets') }}</div>
              <p class="desc">{{ t('set.gen.snippetsDesc') }}</p>
              <div v-for="s in store.snippets" :key="s.id" class="snip-row">
                <span class="snip-title">{{ s.title }}<template v-if="s.group"> · {{ s.group }}</template></span>
                <span class="snip-text">{{ oneLine(s.text) }}</span>
                <span v-if="s.hostId" class="snip-host">{{ hostLabel(s.hostId) }}</span>
                <button class="ghost" @click="editSnippet(s)">{{ t('set.gen.edit') }}</button>
                <button class="ghost" @click="deleteSnippet(s.id)">{{ t('set.gen.delete') }}</button>
              </div>
              <div v-if="snippetForm.open" class="snip-form">
                <input
                  v-model="snippetForm.title"
                  class="snip-in"
                  :placeholder="t('set.gen.snipName')"
                  spellcheck="false"
                />
                <textarea
                  v-model="snippetForm.text"
                  class="snip-in snip-ta"
                  :placeholder="t('set.gen.snipPlaceholder')"
                  spellcheck="false"
                />
                <input
                  v-model="snippetForm.group"
                  class="snip-in"
                  :placeholder="t('set.gen.snipGroup')"
                  spellcheck="false"
                />
                <label class="field host-scope">
                  <span class="snip-lbl">{{ t('set.gen.snipHostScope') }}</span>
                  <select v-model="snippetForm.hostId" class="snip-in select">
                    <option value="">{{ t('set.gen.snipHostAll') }}</option>
                    <option v-for="h in store.hosts" :key="h.id" :value="h.id">{{ h.label }}</option>
                  </select>
                </label>
                <label class="field">
                  <span class="snip-lbl">{{ t('set.gen.snipDefaultVars') }}</span>
                  <textarea
                    v-model="snippetForm.defaultVars"
                    class="snip-in snip-ta snip-vars"
                    :placeholder="t('set.gen.snipDefaultVarsPh')"
                    spellcheck="false"
                  />
                </label>
                <label class="field check">
                  <input v-model="snippetForm.confirm" type="checkbox" />
                  <span class="check-label">{{ t('set.gen.snipConfirm') }}</span>
                </label>
                <div class="snip-actions">
                  <button class="ghost" @click="snippetForm.open = false">{{ t('set.gen.cancel') }}</button>
                  <button class="primary" :disabled="!snippetForm.title.trim() || !snippetForm.text.trim()" @click="saveSnippet">{{ t('set.gen.save') }}</button>
                </div>
              </div>
              <button v-else class="ghost" @click="startNewSnippet">{{ t('set.gen.newSnippet') }}</button>
            </div>
            <div class="section">
              <div class="label">{{ t('set.gen.update') }}</div>
              <p class="desc">{{ t('set.gen.updateDesc') }}</p>
              <div class="editor-row">
                <span class="path" :class="{ dim: !updateState.latest }">
                  <template v-if="updateState.fresh">{{ t('set.gen.upToDate', { v: updateState.latest }) }}</template>
                  <template v-else-if="updateState.latest">{{ t('set.gen.updateAvail', { v: updateState.latest }) }}</template>
                  <template v-else>{{ t('set.gen.updateUnknown') }}</template>
                </span>
                <button class="ghost" :disabled="updateState.checking" @click="checkForUpdates">
                  {{ updateState.checking ? t('set.gen.updateChecking') : t('set.gen.updateCheck') }}
                </button>
                <button v-if="updateState.url" class="ghost" @click="openUpdatePage">{{ t('set.gen.updateOpen') }}</button>
              </div>
              <p v-if="updateState.error" class="desc err">{{ updateState.error }}</p>
              <p v-if="updateState.notes && !updateState.fresh" class="desc update-notes">{{ updateState.notes }}</p>
            </div>
          </template>

          <!-- 终端 -->
          <template v-else-if="store.settingsTab === 'terminal'">
            <div class="section">
              <div class="label">{{ t('set.term.appearance') }}</div>
              <div class="field">
                <span class="fname">{{ t('set.term.font') }}</span>
                <div class="select-wrap">
                  <select class="select-in" :value="store.terminalFontFamily" @change="onFont">
                    <option value="">{{ t('set.term.systemDefault') }}</option>
                    <option v-for="f in fontList" :key="f" :value="f">{{ f }}</option>
                  </select>
                  <Icon name="chevron-down" :size="15" class="select-caret" />
                </div>
              </div>
              <div class="field">
                <span class="fname">{{ t('set.term.cursor') }}</span>
                <div class="seg">
                  <button
                    v-for="o in cursorOptions"
                    :key="o.v"
                    :class="{ on: store.terminalCursor === o.v }"
                    @click="setCursor(o.v)"
                  >
                    {{ o.label }}
                  </button>
                </div>
              </div>
              <div class="field">
                <span class="fname">{{ t('set.term.theme') }}</span>
                <div class="select-wrap">
                  <select class="select-in" :value="store.terminalTheme" @change="onTheme">
                    <option value="">{{ t('set.term.themeSystem') }}</option>
                    <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
                  </select>
                  <Icon name="chevron-down" :size="15" class="select-caret" />
                </div>
              </div>
              <div class="field">
                <span class="fname">{{ t('set.term.accent') }}</span>
                <div class="accent-row">
                  <input type="color" class="accent-input" :value="store.accentColor || '#6ea8fe'" @input="onAccent" />
                  <button v-if="store.accentColor" class="ghost" @click="clearAccent">{{ t('set.term.accentReset') }}</button>
                </div>
              </div>
              <p class="desc">{{ t('set.term.fontHint', { keys: `${modKey}+= / ${modKey}+-` }) }}</p>
            </div>
            <div class="section">
              <div class="label">{{ t('set.term.safety') }}</div>
              <label class="toggle-row" @click="toggleConfirmPaste">
                <span>
                  <span class="fname">{{ t('set.term.confirmPaste') }}</span>
                  <span class="sub">{{ t('set.term.confirmPasteDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.confirmPaste }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleSanitizePaste">
                <span>
                  <span class="fname">{{ t('set.term.sanitizePaste') }}</span>
                  <span class="sub">{{ t('set.term.sanitizePasteDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.sanitizePaste }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleCopyOnSelect">
                <span>
                  <span class="fname">{{ t('set.term.copyOnSelect') }}</span>
                  <span class="sub">{{ t('set.term.copyOnSelectDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.copyOnSelect }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleMiddleClickPaste">
                <span>
                  <span class="fname">{{ t('set.term.middleClickPaste') }}</span>
                  <span class="sub">{{ t('set.term.middleClickPasteDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.middleClickPaste }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleRightClickPaste">
                <span>
                  <span class="fname">{{ t('set.term.rightClickPaste') }}</span>
                  <span class="sub">{{ t('set.term.rightClickPasteDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.rightClickPaste }"><i /></span>
              </label>
            </div>
            <div class="section">
              <div class="label">{{ t('set.term.integration') }}</div>
              <label class="toggle-row" @click="toggleShell">
                <span>
                  <span class="fname">{{ t('set.term.cwdSync') }}</span>
                  <span class="sub">{{ t('set.term.cwdSyncDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.shellIntegration }"><i /></span>
              </label>
            </div>
          </template>

          <!-- 连接 -->
          <template v-else-if="store.settingsTab === 'connection'">
            <div class="section">
              <div class="label">{{ t('set.conn.keepalive') }}</div>
              <div class="field">
                <span class="fname">{{ t('set.conn.interval') }}</span>
                <input
                  class="num-in"
                  type="number"
                  min="0"
                  max="600"
                  :value="store.keepaliveSec"
                  @input="onKeepalive"
                />
                <span class="unit">{{ t('set.conn.seconds') }}</span>
              </div>
              <p class="desc">{{ t('set.conn.keepaliveDesc') }}</p>
            </div>
            <div class="section">
              <div class="label">{{ t('set.conn.timeout') }}</div>
              <div class="field">
                <span class="fname">{{ t('set.conn.timeoutVal') }}</span>
                <input
                  class="num-in"
                  type="number"
                  min="1"
                  max="300"
                  :value="store.connectTimeoutSec"
                  @input="onTimeout"
                />
                <span class="unit">{{ t('set.conn.seconds') }}</span>
              </div>
              <p class="desc">{{ t('set.conn.timeoutDesc') }}</p>
              <div class="field">
                <span class="fname">{{ t('set.conn.retriesVal') }}</span>
                <input
                  class="num-in"
                  type="number"
                  min="0"
                  max="30"
                  :value="store.connectRetries"
                  @input="onRetries"
                />
                <span class="unit">{{ t('set.conn.times') }}</span>
              </div>
              <p class="desc">{{ t('set.conn.retriesDesc') }}</p>
            </div>
            <div class="section">
              <div class="label">{{ t('set.conn.xfer') }}</div>
              <div class="field">
                <span class="fname">{{ t('set.conn.xferConc') }}</span>
                <input
                  class="num-in"
                  type="number"
                  min="1"
                  max="32"
                  :value="store.transferConcurrency"
                  @input="onConcurrency"
                />
                <span class="unit">{{ t('set.conn.files') }}</span>
              </div>
              <div class="field">
                <span class="fname">{{ t('set.conn.xferRate') }}</span>
                <input
                  class="num-in"
                  type="number"
                  min="0"
                  max="131072"
                  :value="store.transferRateKbps"
                  @input="onRate"
                />
                <span class="unit">{{ t('set.conn.kbps') }}</span>
              </div>
              <p class="desc">{{ t('set.conn.xferRateDesc') }}</p>
              <label class="toggle-row" @click="toggleVerifyChecksums">
                <span>
                  <span class="fname">{{ t('set.conn.verifyChecksums') }}</span>
                  <span class="sub">{{ t('set.conn.verifyChecksumsDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.verifyChecksums }"><i /></span>
              </label>
            </div>
            <div class="section">
              <div class="label">{{ t('set.conn.drop') }}</div>
              <label class="toggle-row" @click="toggleAutoReconnect">
                <span>
                  <span class="fname">{{ t('set.conn.autoReconnect') }}</span>
                  <span class="sub">{{ t('set.conn.autoReconnectDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.autoReconnect }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleNotifications">
                <span>
                  <span class="fname">{{ t('set.conn.notify') }}</span>
                  <span class="sub">{{ t('set.conn.notifyDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.notifications }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleNotifySound">
                <span>
                  <span class="fname">{{ t('set.conn.notifySound') }}</span>
                  <span class="sub">{{ t('set.conn.notifySoundDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.notifySound }"><i /></span>
              </label>
              <label class="toggle-row" @click="toggleConfirmClose">
                <span>
                  <span class="fname">{{ t('set.conn.confirmClose') }}</span>
                  <span class="sub">{{ t('set.conn.confirmCloseDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.confirmClose }"><i /></span>
              </label>
            </div>
          </template>

          <!-- 安全 -->
          <template v-else-if="store.settingsTab === 'security'">
            <div class="section">
              <div class="label">{{ t('set.sec.known') }}</div>
              <p class="desc">{{ t('set.sec.knownDesc') }}</p>
              <div v-for="k in store.knownHosts" :key="`${k.host}:${k.port}`" class="kh-row">
                <span class="kh-host">{{ k.host }}:{{ k.port }}</span>
                <span class="kh-fp">{{ k.fingerprint }}</span>
                <span v-if="keyAge(k.firstSeen)" class="kh-age" :class="{ stale: keyStale(k.firstSeen) }" :title="keyStale(k.firstSeen) ? t('set.sec.keyStaleTip') : t('set.sec.keyAge')">{{ keyAge(k.firstSeen) }}</span>
                <button class="ghost" @click="forgetKnownHost(k)">{{ t('set.sec.delete') }}</button>
              </div>
              <div v-if="!store.knownHosts.length" class="desc">{{ t('set.sec.empty') }}</div>
            </div>
            <div class="section">
              <div class="label">{{ t('set.sec.connLog') }}</div>
              <p class="desc">{{ t('set.sec.connLogDesc') }}</p>
              <div v-for="(l, i) in connLog" :key="i" class="cl-row">
                <span class="cl-time">{{ connTime(l.at) }}</span>
                <span class="cl-event" :class="l.event">{{ eventLabel(l.event) }}</span>
                <span class="cl-host">{{ l.username }}@{{ l.host }}:{{ l.port }}</span>
                <span v-if="l.detail" class="cl-detail">{{ l.detail }}<template v-if="l.bytes != null"> · {{ fmtBytes(l.bytes) }}</template></span>
              </div>
              <div v-if="!connLog.length" class="desc">{{ t('set.sec.connLogEmpty') }}</div>
              <button v-if="connLog.length" class="ghost" @click="clearConnLog">{{ t('set.sec.connLogClear') }}</button>
            </div>
            <div class="section">
              <div class="label">{{ t('set.sec.sshConfig') }}</div>
              <p class="desc">{{ t('set.sec.sshConfigDesc') }}</p>
              <div class="btn-row">
                <button class="ghost" @click="importSshConfig">{{ t('set.sec.import') }}</button>
                <button class="ghost" @click="exportSshConfig">{{ t('set.sec.export') }}</button>
              </div>
            </div>
            <div class="section">
              <div class="label">{{ t('set.sec.backup') }}</div>
              <p class="desc">{{ t('set.sec.backupDesc') }}</p>
              <div class="btn-row">
                <button class="ghost" @click="exportHostsJson">{{ t('set.sec.export') }}</button>
                <button class="ghost" @click="importHostsJson">{{ t('set.sec.restore') }}</button>
              </div>
              <p class="desc">{{ t('set.sec.fullBackupDesc') }}</p>
              <div class="btn-row">
                <button class="ghost" @click="exportAllData">{{ t('set.sec.exportAll') }}</button>
                <button class="ghost" @click="importAllData">{{ t('set.sec.importAll') }}</button>
              </div>
            </div>
            <div class="section">
              <div class="label">{{ t('lock.title') }}</div>
              <p class="desc">{{ t('lock.desc') }}</p>
              <div class="lock-opts">
                <template v-if="store.lockEnabled">
                  <label class="backup-row">
                    <span class="backup-label">{{ t('lock.current') }}</span>
                    <input v-model="currentPass" type="password" class="lock-in" :placeholder="t('lock.placeholder')" />
                  </label>
                  <div v-if="store.lockLocked" class="btn-row">
                    <button class="ghost" @click="unlockNow">{{ t('lock.unlock') }}</button>
                  </div>
                  <div class="btn-row">
                    <button class="ghost" :disabled="lockBusy" @click="disableMasterLock">{{ t('lock.disable') }}</button>
                    <button class="ghost" @click="lockApp">{{ t('lock.lockNow') }}</button>
                    <button class="ghost danger" @click="resetMasterLock">{{ t('lock.reset') }}</button>
                  </div>
                </template>
                <template v-else>
                  <label class="backup-row">
                    <span class="backup-label">{{ t('lock.new') }}</span>
                    <input v-model="lockNewPass" type="password" class="lock-in" :placeholder="t('lock.placeholder')" />
                  </label>
                  <div class="btn-row">
                    <button class="ghost" :disabled="lockBusy" @click="saveMasterLock">{{ t('lock.save') }}</button>
                  </div>
                </template>
                <p class="desc">{{ t('lock.setHint') }}</p>
              </div>
            </div>
            <div class="section">
              <div class="label">{{ t('set.sec.autoBackup') }}</div>
              <label class="toggle-row" @click="toggleAutoBackup">
                <span>
                  <span class="fname">{{ t('set.sec.autoBackup') }}</span>
                  <span class="sub">{{ t('set.sec.autoBackupDesc') }}</span>
                </span>
                <span class="switch" :class="{ on: store.autoBackup }"><i /></span>
              </label>
              <div v-if="store.autoBackup" class="backup-opts">
                <div class="backup-row">
                  <span class="backup-label">{{ t('set.sec.backupDir') }}</span>
                  <span class="backup-val">{{ store.autoBackupDir || t('set.sec.backupDirNone') }}</span>
                  <button class="ghost" @click="pickBackupDir">{{ t('host.browse') }}</button>
                </div>
                <div class="backup-row">
                  <span class="backup-label">{{ t('set.sec.backupEvery') }}</span>
                  <label class="hour-input">
                    <input :value="store.autoBackupEveryHours" type="number" min="1" max="720" @change="onBackupHours" />
                    <span class="unit">{{ t('set.sec.hours') }}</span>
                  </label>
                </div>
                <button class="ghost" :disabled="backupBusy" @click="backupNow">{{ t('set.sec.backupNow') }}</button>
              </div>
            </div>
          </template>

          <!-- 快捷键 -->
          <template v-else>
            <div class="section">
              <div class="label">{{ t('set.sc.custom') }}</div>
              <p class="desc">{{ t('set.sc.customDesc') }}</p>
              <div v-for="id in REBINDABLE_ACTIONS" :key="id" class="sc-row rebind">
                <div class="sc-keys">
                  <template v-for="(part, pi) in parts(bindingOf(id))" :key="pi">
                    <span v-if="part.sep" class="sc-sep">{{ part.sep }}</span>
                    <span v-for="(k, ki) in part.chord || []" :key="ki" class="kbd">{{ k }}</span>
                  </template>
                </div>
                <div class="sc-desc">{{ t('sck.' + DESC_KEY[id]) }}</div>
                <div v-if="recording !== id" class="sc-actions">
                  <button class="ghost" @click="startRecord(id)">{{ t('set.sc.rebind') }}</button>
                  <button v-if="store.keybindings[id]" class="ghost" @click="resetBinding(id)">{{ t('set.sc.reset') }}</button>
                </div>
                <div v-else class="sc-actions">
                  <span class="kbd rec">{{ t('set.sc.recording') }}</span>
                  <button class="ghost" @click="recording = null">{{ t('set.sc.cancel') }}</button>
                </div>
              </div>
              <div v-if="recording" class="rec-capture" @keydown.prevent="recordChord($event, recording)" tabindex="-1" ref="recCaptureEl"></div>
            </div>
            <section v-for="g in groups" :key="g.id" class="sc-group">
              <div class="label">{{ t('group.' + g.id) }}</div>
              <div v-for="item in g.items" :key="item.keys" class="sc-row">
                <div class="sc-keys">
                  <template v-for="(part, pi) in parts(item.keys)" :key="pi">
                    <span v-if="part.sep" class="sc-sep">{{ part.sep }}</span>
                    <span v-for="(k, ki) in part.chord || []" :key="ki" class="kbd">{{ k }}</span>
                  </template>
                </div>
                <div class="sc-desc">
                  {{ t('sck.' + item.key) }}
                  <span v-if="hintOf(item.key)" class="sub">{{ withMod(hintOf(item.key)) }}</span>
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
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  animation: fade-in 0.12s ease;
  align-items: center;
  padding: 24px;
  z-index: 110;
}
.dialog {
  display: flex;
  flex-direction: column;
  width: min(760px, 94vw);
  height: min(560px, 82vh);
  background-color: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  outline: none;
  animation: pop-in 0.16s cubic-bezier(0.2, 0.8, 0.3, 1);
}
.section + .section, .sc-group + .sc-group {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  padding: 14px 16px;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}
.x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  color: var(--text-dim);
}
.x:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-size: 12px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.desc {
  font-size: 12px;
  color: var(--text-faint);
  line-height: 1.5;
}
.desc.err {
  color: var(--danger);
}
.update-notes {
  margin-top: 8px;
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-family: var(--font-mono);
  font-size: 11px;
}
.editor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.opener-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.opener-ext {
  width: 90px;
  height: 32px;
  padding: 0 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}
.opener-prog {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}
.opener-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.opener-ext-tag {
  flex: none;
  width: 60px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
}
.opener-prog-tag {
  flex: 1;
  min-width: 0;
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-dim);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.accent-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.accent-input {
  width: 38px;
  height: 34px;
  padding: 2px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}.path {
  flex: 1;
  min-width: 0;
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.path.dim {
  color: var(--text-faint);
}
.ghost {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.ghost:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.btn-row {
  display: flex;
  gap: 8px;
}
.lock-opts {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
}
.lock-in {
  flex: 1;
  height: 32px;
  min-width: 0;
  padding: 0 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}
.lock-in:focus {
  border-color: var(--accent);
}
.ghost.danger {
  color: var(--danger);
}
.ghost.danger:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-color: var(--danger);
}
.backup-opts {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}
.backup-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.backup-label {
  font-size: 12px;
  color: var(--text-dim);
  flex: none;
  width: 80px;
}
.backup-val {
  flex: 1;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hour-input {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hour-input input {
  width: 64px;
  height: 30px;
  padding: 0 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}
.hour-input .unit {
  font-size: 12px;
  color: var(--text-dim);
}
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.fname {
  font-size: 13px;
  color: var(--text);
}
.select-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.select-in {
  width: 100%;
  height: 32px;
  padding: 0 32px 0 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.select-in:focus {
  border-color: var(--accent);
}
.select-caret {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-dim);
  pointer-events: none;
}
.num-in {
  width: 72px;
  height: 32px;
  padding: 0 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  outline: none;
}
.num-in:focus {
  border-color: var(--accent);
}
/* Hide the native (light-colored) number spinner; arrow keys still work. */
.num-in::-webkit-inner-spin-button,
.num-in::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.unit {
  font-size: 12px;
  color: var(--text-faint);
}
.seg {
  display: flex;
  gap: 3px;
  padding: 3px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.seg button {
  padding: 5px 12px;
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;
  cursor: pointer;
}
.toggle-row .sub {
  display: block;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.45;
}
.toggle-row .sub.err {
  color: var(--danger);
}
.toggle-row > span:first-child {
  flex: 1 1 auto;
  min-width: 0;
}
.toggle-row .text {
  display: block;
  width: 100%;
  height: 32px;
  margin-top: 6px;
  padding: 0 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
  box-sizing: border-box;
}
.toggle-row .text:hover {
  border-color: var(--border-strong);
}
.toggle-row .text:focus {
  border-color: var(--accent);
}
.switch {
  flex: none;
  position: relative;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border-strong);
  transition: background 0.15s;
}
.switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-faint);
  transition: transform 0.15s, background 0.15s;
}
.switch.on {
  background: var(--accent);
  border-color: var(--accent);
}
.switch.on i {
  transform: translateX(16px);
  background: #fff;
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.nav {
  flex: none;
  width: 148px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-dim);
  text-align: left;
  transition: background 0.13s, color 0.13s;
}
.nav-item:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.nav-item.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 18px 20px;
}
.sc-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 5px 0;
}
.sc-keys {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  width: 196px;
}
.sc-sep {
  color: var(--text-faint);
  font-size: 11px;
  margin: 0 2px;
}
.sc-desc {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
}
.sc-desc .sub {
  display: block;
  margin-top: 1px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.sc-actions {
  flex: none;
  display: flex;
  gap: 6px;
}
.sc-row.rebind {
  align-items: center;
}
.sc-actions .ghost {
  height: 24px;
  padding: 0 8px;
  font-size: 11.5px;
}
.kbd.rec {
  color: var(--accent);
  border-color: var(--accent);
}
.rec-capture {
  position: fixed;
  inset: 0;
  z-index: 130;
  cursor: crosshair;
}
@media (max-width: 620px) {
  .sc-row { flex-direction: column; gap: 4px; padding: 8px 0; }
  .sc-keys { width: auto; }
  .nav { width: 112px; }
}

/* ---- snippets ---- */
.snip-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}
.snip-title {
  flex: none;
  min-width: 90px;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.snip-text {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.snip-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.snip-in {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}
.snip-in:focus {
  border-color: var(--accent);
}
.snip-ta {
  height: 72px;
  padding: 8px 10px;
  font-family: var(--font-mono);
  resize: vertical;
}
.snip-vars {
  height: 54px;
}
.snip-lbl {
  font-size: 11px;
  color: var(--text-dim);
}
.host-scope {
  flex-direction: column;
  align-items: stretch;
}
.host-scope .snip-in.select {
  height: 32px;
  appearance: auto;
  -webkit-appearance: auto;
  cursor: pointer;
}
.snip-host {
  flex: none;
  font-size: 11px;
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}.snip-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.snip-actions .primary {
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}
.snip-actions .primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---- known hosts ---- */
.kh-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}
.kh-host {
  flex: none;
  min-width: 120px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kh-fp {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kh-age {
  flex: none;
  font-size: 11px;
  color: var(--warn);
  font-variant-numeric: tabular-nums;
}
.kh-age.stale {
  color: var(--danger);
  font-weight: 600;
}
.cl-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: 12px;
}
.cl-time {
  flex: none;
  width: 130px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.cl-event {
  flex: none;
  width: 72px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  text-align: center;
}
.cl-event.connect {
  color: var(--ok);
  background: rgba(81, 207, 102, 0.12);
}
.cl-event.disconnect {
  color: var(--warn);
  background: rgba(255, 212, 59, 0.12);
}
.cl-event.error {
  color: var(--danger);
  background: rgba(255, 107, 107, 0.12);
}
.cl-event.transfer {
  color: var(--accent);
  background: rgba(96, 165, 250, 0.14);
}
.cl-event.forward {
  color: var(--ok);
  background: rgba(81, 207, 102, 0.12);
}
.cl-host {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cl-detail {
  flex: none;
  font-size: 11px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
</style>
