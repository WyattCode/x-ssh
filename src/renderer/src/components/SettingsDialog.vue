<script setup lang="ts">
import { ref, computed, watch, nextTick, reactive } from 'vue'
import { useSessions } from '../stores/sessions'
import Icon from './Icon.vue'
import { SHORTCUT_GROUPS } from '../lib/shortcuts'
import { splitShortcutChips } from '../lib/shortcutChips'
import { PRESETS } from '../lib/terminalThemes'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import type { SettingsTab } from '../stores/sessions'
import type { KnownHostEntry } from '../../../shared/types'

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

const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
const modKey = isMac ? '⌘' : 'Ctrl'
const withMod = (t: string): string => t.split('Mod').join(modKey)

/** Splits a spec into chip groups and the separators between them:
 *  "Mod+1 … Mod+8" renders as [Ctrl][1] … [Ctrl][8]. */
function parts(keys: string): { chord?: string[]; sep?: string }[] {
  return splitShortcutChips(keys).map((piece) =>
    'sep' in piece
      ? { sep: piece.sep === 'or' ? t('kbd.or') : '…' }
      : { chord: piece.chord.map(withMod) }
  )
}

const groups = SHORTCUT_GROUPS
// Returns the translated note for a shortcut key, or '' when none exists.
function hintOf(key: string): string {
  const k = 'sck.' + key + 'Hint'
  const v = t(k)
  return v !== k ? v : ''
}
const dialogEl = ref<HTMLElement>()

// Focus the dialog on open so Esc (bound below) works without a prior click.
watch(
  () => store.settingsOpen,
  (o) => {
    if (o) nextTick(() => dialogEl.value?.focus())
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
              <p class="desc">{{ t('set.conn.xferDesc') }}</p>
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
                <button class="ghost" @click="forgetKnownHost(k)">{{ t('set.sec.delete') }}</button>
              </div>
              <div v-if="!store.knownHosts.length" class="desc">{{ t('set.sec.empty') }}</div>
            </div>
            <div class="section">
              <div class="label">{{ t('set.sec.sshConfig') }}</div>
              <p class="desc">{{ t('set.sec.sshConfigDesc') }}</p>
              <button class="ghost" @click="importSshConfig">{{ t('set.sec.import') }}</button>
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
.editor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.path {
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
</style>
