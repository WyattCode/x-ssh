<script setup lang="ts">
import {
  onMounted,
  onBeforeUnmount,
  ref,
  reactive,
  computed,
  watch,
  nextTick,
  defineAsyncComponent
} from 'vue'
import { useSessions } from './stores/sessions'
import { appMod, isMac } from './composables/platform'
import TabBar from './components/TabBar.vue'
import CommandPalette from './components/CommandPalette.vue'
import HostEditor from './components/HostEditor.vue'
import TextEditor from './components/TextEditor.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ToastHost from './components/ToastHost.vue'
import HistorySearch from './components/HistorySearch.vue'
import TmuxDialog from './components/TmuxDialog.vue'
import ForwardDialog from './components/ForwardDialog.vue'
import PublishKeyDialog from './components/PublishKeyDialog.vue'
import SessionReplayDialog from './components/SessionReplayDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import StatusBar from './components/StatusBar.vue'
import Icon from './components/Icon.vue'
import PaneNode from './components/PaneNode.vue'
import TransferPanel from './components/TransferPanel.vue'
import SnippetVarsDialog from './components/SnippetVarsDialog.vue'
import TooltipLayer from './components/TooltipLayer.vue'
import LockScreen from './components/LockScreen.vue'
import ZoomHud from './components/ZoomHud.vue'
import { useZoom, ZOOM_STEP } from './composables/zoom'
import { useI18n } from './lib/i18n'
import { collectPaneIds } from './lib/paneLayout'
import {
  DEFAULT_BINDINGS,
  REBINDABLE_ACTIONS,
  chordMatches,
  type RebindableAction
} from './lib/shortcuts'
import AppSidebar from './components/AppSidebar.vue'
import HostsPage from './components/HostsPage.vue'
import ForwardsPage from './components/ForwardsPage.vue'
import OsIcon from './components/OsIcon.vue'
import type { Host } from '../../shared/types'

// Neither of these can be on screen at startup — a restored tab comes back
// disconnected, and the file drawer needs a live session — so keep them (and
// the whole xterm bundle behind TerminalView) out of the first-paint chunk.
// They are prefetched once the window is up, so opening one still feels instant.
const TerminalView = defineAsyncComponent(() => import('./components/TerminalView.vue'))
const SftpDrawer = defineAsyncComponent(() => import('./components/SftpDrawer.vue'))

const store = useSessions()
const { t } = useI18n()

// Modifier symbol shown in hints (⌘ on macOS, Ctrl elsewhere).
const modKey = isMac ? '⌘' : 'Ctrl'

// ---- SFTP page: which live session it browses ----
/** Every connected pane, labelled by its tab (a split tab lists each pane). */
const connectedPanes = computed(() =>
  store.tabs.flatMap((tab) =>
    tab.panes
      .filter((p) => p.status === 'connected' && p.sshSessionId)
      .map((pane) => ({ tab, pane, host: store.hosts.find((h) => h.id === pane.params.hostId) }))
  )
)
/** The page follows the active pane when it's live, like the drawer does. */
const sftpPane = computed(() =>
  store.activePane?.status === 'connected' && store.activePane.sshSessionId ? store.activePane : undefined
)
function pickSftpPane(tabId: string, paneId: string): void {
  store.setActive(tabId)
  store.setActivePane(tabId, paneId)
}
// Arriving on SFTP with a dead / no active pane: take the first live one.
watch(
  () => [store.page, connectedPanes.value.length] as const,
  ([page]) => {
    if (page === 'sftp' && !sftpPane.value && connectedPanes.value.length) {
      const first = connectedPanes.value[0]
      pickSftpPane(first.tab.id, first.pane.id)
    }
  }
)
function connectForSftp(h: Host): Promise<void> {
  return store.openSftpFor(h)
}
/** Online dot on the host picker, same meaning as on 连接 (no probe of its own). */
const pickState = (h: Host): string => store.reach[h.id] ?? 'unknown'
const sftpHosts = computed(() => [...store.hosts].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)))

// Closing the last terminal goes back to the host list rather than an empty page.
watch(
  () => store.tabs.length,
  (n, before) => {
    if (!n && before && store.page === 'terminal') store.setPage('hosts')
  }
)

const editorOpen = ref(false)
const editingHost = ref<Host | null>(null)
const editorFileOpen = ref(false)
const editFilePayload = ref<{ path: string; name: string }>({ path: '', name: '' })
const sftpReloadKey = ref(0)

function onEditFile(p: { path: string; name: string }): void {
  editFilePayload.value = p
  editorFileOpen.value = true
}
function onEditorSaved(): void {
  // The file was rewritten remotely — refresh the SFTP listing so the drawer
  // reflects the new size / mtime.
  sftpReloadKey.value++
}
async function onEditExternal(p: { path: string; name: string }): Promise<void> {
  const sid = store.activePane?.sshSessionId
  if (sid) await window.api.sftp.editExternal(sid, p.path, p.name)
}
async function onOpenWith(p: { path: string; name: string; ext: string }): Promise<void> {
  const sid = store.activePane?.sshSessionId
  if (!sid) return
  const program = store.fileOpeners[p.ext] || undefined
  await window.api.sftp.openWith(sid, p.path, p.name, program)
}

// Per-session working directory reported by shell integration (OSC 7).
const cwds = reactive<Record<string, string>>({})
function onCwd(p: { sessionId: string; path: string }): void {
  cwds[p.sessionId] = p.path
  // Drop entries for sessions that no longer exist (reconnect mints a new id).
  const live = new Set(
    store.tabs.flatMap((t) => t.panes.map((pane) => pane.sshSessionId)).filter(Boolean)
  )
  for (const k of Object.keys(cwds)) if (!live.has(k)) delete cwds[k]
}
const activeCwd = computed(() => {
  const sid = store.activePane?.sshSessionId
  return sid ? cwds[sid] : undefined
})
// Send a `cd` to the active terminal (single-quoted, with safe escaping).
function onCdTerminal(path: string): void {
  const sid = store.activePane?.sshSessionId
  if (!sid) return
  const quoted = `'${path.replace(/'/g, `'\\''`)}'`
  window.api.ssh.input(sid, `cd ${quoted}\n`)
}

// The "session closed" banner. Focus its button as soon as it appears: the
// dead terminal still holds focus otherwise, so Enter (and any key) goes
// nowhere — the banner would be reachable by mouse only.
const bannerShown = computed(
  () => store.activePane?.status === 'closed' && !!store.activePane?.sshSessionId
)
const bannerBtn = ref<HTMLButtonElement>()
watch(bannerShown, (shown) => {
  if (!shown) return
  // Never pull focus out of a modal: the palette, host editor and confirm
  // dialog all bind Esc/Enter on their own element, so taking focus away
  // silently disables those keys while the dialog is still up. The host
  // editor's root is `.layer`, everything else uses `.overlay`.
  if (document.querySelector('.overlay, .layer')) return
  // Nor from someone mid-word in any other field (a rename box, the SFTP
  // filter…). The dead terminal is exactly what we do want to take it from,
  // and focus sits in its hidden textarea — hence the .xterm exception.
  const el = document.activeElement as HTMLElement | null
  const typing =
    !el?.closest?.('.xterm') &&
    (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable === true)
  if (typing) return
  nextTick(() => bannerBtn.value?.focus())
})

function openNewHost(): void {
  editingHost.value = null
  editorOpen.value = true
}
function openEditHost(h: Host): void {
  editingHost.value = h
  editorOpen.value = true
}

// Zoom (shortcuts, Ctrl+wheel, the pill's own buttons) goes through one place,
// which also shows the percentage pill — see composables/zoom.ts.
const zoom = useZoom()

function onWheel(e: WheelEvent): void {
  // ⌘ (macOS) / Ctrl (elsewhere) + wheel zooms the whole UI. On macOS we require
  // ⌘ specifically so Ctrl+wheel stays free for macOS's system screen zoom.
  if (!appMod(e)) return
  e.preventDefault()
  e.stopPropagation()
  zoom.bump(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
}

function onNetworkOnline(): void {
  store.handleNetworkOnline()
}
function onNetworkOffline(): void {
  store.handleNetworkOffline()
}

function onGlobalKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  const inTerminal = !!t?.closest?.('.xterm')
  const inEditable =
    !inTerminal &&
    (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable === true)
  // Don't hijack typing in form fields (editors, rename, search…).
  if (inEditable) return

  // Number-jump and terminal copy/paste are hard-wired (not rebindable).
  // ⌘ on macOS, Ctrl elsewhere — leaves Ctrl+1..9 free for the shell on macOS.
  const mod = appMod(e)
  if (mod && !e.shiftKey && e.key >= '1' && e.key <= '9') {
    e.preventDefault()
    const n = Number(e.key)
    const tab = n === 9 ? store.tabs[store.tabs.length - 1] : store.tabs[n - 1]
    if (tab) {
      store.setActive(tab.id)
      store.setPage('terminal')
    }
    return
  }

  // Resolve the effective chord for each rebindable action (user override or
  // default) and dispatch to a handler when the key matches. Ctrl+W respects a
  // live terminal (werase) via a flag on the handler.
  const effective = (id: string): string => store.keybindings[id] ?? DEFAULT_BINDINGS[id as RebindableAction]
  // Terminals stay mounted behind the other pages; the shortcuts that act on
  // one (close, split, focus…) only apply where you can see it.
  const onTerm = store.page === 'terminal'
  const handlers: Record<RebindableAction, () => void> = {
    palette: () => store.togglePalette(),
    palette2: () => store.togglePalette(),
    newTab: () => store.togglePalette(true),
    closeTab: () => {
      if (!onTerm) return
      if (inTerminal && store.activePane?.status === 'connected') return
      if (store.activeId) void store.closeTabSafe(store.activeId)
    },
    nextTab: () => {
      store.nextTab(1)
      if (store.tabs.length) store.setPage('terminal')
    },
    prevTab: () => {
      store.nextTab(-1)
      if (store.tabs.length) store.setPage('terminal')
    },
    split: () => {
      if (onTerm && store.active && store.activePane?.status === 'connected') void store.splitPane(store.active.id, 'row')
    },
    splitCol: () => {
      if (onTerm && store.active && store.activePane?.status === 'connected') void store.splitPane(store.active.id, 'col')
    },
    focus: () => {
      if (!onTerm) return
      const tab = store.active
      const order = tab ? collectPaneIds(tab.layout) : []
      if (order.length > 1) {
        const i = order.indexOf(tab!.activePaneId)
        const next = order[(i + 1) % order.length]
        store.setActivePane(tab!.id, next)
      }
    },
    closePane: () => {
      if (onTerm && store.activePane) store.closePane(store.activePane.id)
    },
    // The drawer on the terminal page; from anywhere else, the SFTP page.
    sftp: () => (onTerm ? store.toggleSftp() : store.setPage('sftp')),
    history: () => store.toggleHistory(),
    settings: () => store.toggleSettings(),
    shortcuts: () => store.toggleSettings(true, 'keys'),
    zoomIn: () => zoom.bump(ZOOM_STEP),
    zoomOut: () => zoom.bump(-ZOOM_STEP),
    zoomReset: () => zoom.reset()
  }
  for (const id of REBINDABLE_ACTIONS) {
    if (chordMatches(e, effective(id))) {
      e.preventDefault()
      handlers[id]()
      return
    }
  }
}

let offEvent: (() => void) | null = null
let offOpenTarget: (() => void) | null = null
let offOnlineChanged: (() => void) | null = null
let offHostsChanged: (() => void) | null = null
/** Converts a #rrggbb hex color into an rgba() string at the given alpha. */
function accentSoft(hex: string, alpha = 0.14): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return ''
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
/** Picks black or white text for a filled accent surface: a light custom
 *  accent (e.g. pale yellow) needs dark labels to stay readable. */
function accentContrast(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
  return lum > 0.45 ? '#0b0d11' : '#fff'
}
// Apply the custom accent (or reset to the theme default) whenever it changes.
watch(
  () => store.accentColor,
  (hex) => {
    const root = document.documentElement
    if (hex) {
      root.style.setProperty('--accent', hex)
      root.style.setProperty('--accent-soft', accentSoft(hex))
      root.style.setProperty('--accent-contrast', accentContrast(hex))
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--accent-soft')
      root.style.removeProperty('--accent-contrast')
    }
  },
  { immediate: true }
)

const booted = ref(false)
onMounted(async () => {
  // The preload already applied the launch-time zoom before the first paint;
  // the stored value wins if it differs (a renderer reload after the user
  // zoomed carries stale launch prefs).
  const storedZoom = Number(await window.api.settings.get<number>('zoom'))
  if (Number.isFinite(storedZoom) && storedZoom !== zoom.level.value) zoom.restore(storedZoom)
  await Promise.all([
    store.loadHosts(),
    store.loadSettings(),
    store.loadSnippets(),
    store.loadKnownHosts(),
    store.loadSftpBookmarks(),
    store.loadSftpRecent(),
    store.loadSnapshots(),
    store.loadLockStatus()
  ])
  await store.restoreSavedTabs()
  // Tabs restored from last time: open on them rather than the host list.
  if (store.tabs.length) store.setPage('terminal')
  booted.value = true
  store.initSftpProgress()
  store.networkOnline = navigator.onLine
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('wheel', onWheel, { passive: false, capture: true })
  window.addEventListener('online', onNetworkOnline)
  window.addEventListener('offline', onNetworkOffline)
  offEvent = window.api.ssh.onEvent((ev) => {
    store.applyEvent(ev.sessionId, ev.status, ev.message)
  })
  // A launch target (CLI `-c user@host` or a x-ssh:// URL) arrives from main:
  // seed the command palette with it so the existing connect/password flow runs.
  offOpenTarget = window.api.onOpenTarget((target) => {
    if (/\s/.test(target)) return
    store.paletteSeed = target
    store.togglePalette(true)
  })
  // Machine woke from sleep / screen unlocked: the network may have dropped while
  // suspended, so re-evaluate connectivity and let dropped sessions retry.
  offOnlineChanged = window.api.onOnlineChanged(() => store.handleWake())
  // Main updated a saved host on its own (the OS detected on connect).
  offHostsChanged = window.api.hosts.onChanged(() => void store.loadHosts())
  // Pull the deferred chunks in while the app is idle, so the first connection
  // never waits on them.
  const prefetch = (): void => {
    void import('./components/TerminalView.vue')
    void import('./components/SftpDrawer.vue')
  }
  if (window.requestIdleCallback) window.requestIdleCallback(prefetch, { timeout: 2000 })
  else setTimeout(prefetch, 200)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  window.removeEventListener('online', onNetworkOnline)
  window.removeEventListener('offline', onNetworkOffline)
  offEvent?.()
  offOpenTarget?.()
  offOnlineChanged?.()
  offHostsChanged?.()
})
</script>

<template>
  <div class="app" :class="{ 'no-sidebar': store.page === 'terminal' && store.termSidebarHidden }">
    <!-- macOS: a strip to drag the window by on pages without a tab bar. -->
    <div v-if="store.page !== 'terminal'" class="mac-drag" />
    <AppSidebar :hidden="store.page === 'terminal' && store.termSidebarHidden" />

    <div class="workspace">
      <div v-if="!store.networkOnline" class="offline-banner">
        <Icon name="wifi-off" :size="14" />
        <span>{{ t('app.networkOffline') }}</span>
      </div>

      <!-- 终端: kept mounted on every page (v-show) so sessions and scrollback live on. -->
      <section v-show="store.page === 'terminal'" class="page term-page">
        <TabBar />
        <main class="stage">
          <div class="main-area">
            <!-- A tab holds a nested split tree of panes rendered recursively. -->
            <template v-for="tab in store.tabs" :key="tab.id">
              <PaneNode
                v-show="tab.id === store.activeId"
                :node="tab.layout"
                :tab="tab"
                :root="true"
                :path="[]"
                :tab-active="tab.id === store.activeId && store.page === 'terminal'"
                :mod-key="modKey"
                @cwd="onCwd"
              />
            </template>

            <div v-if="!store.tabs.length" class="term-empty">
              <span class="term-empty-icon"><Icon name="terminal" :size="26" /></span>
              <p>{{ t('term.empty') }}</p>
              <button class="btn btn-tinted pill" @click="store.setPage('hosts')">{{ t('nav.hosts') }}</button>
            </div>

            <!-- Disconnected banner for the active pane -->
            <div v-if="bannerShown" class="closed-banner">
              <span>{{ t('app.sessionClosed') }}</span>
              <button
                ref="bannerBtn"
                class="banner-btn"
                @click="store.activePane && store.reconnect(store.activePane.id)"
              >{{ t('app.reconnect') }}</button>
              <span class="banner-dim">{{ t('app.orClose', { keys: `${modKey}+W` }) }}</span>
            </div>
          </div>

          <SftpDrawer
            v-if="store.page === 'terminal' && store.sftpOpen && store.activePane?.status === 'connected'"
            :session-id="store.activePane?.sshSessionId"
            :open="store.sftpOpen"
            :terminal-cwd="activeCwd"
            :reload-key="sftpReloadKey"
            @close="store.toggleSftp(false)"
            @edit-file="onEditFile"
            @edit-external="onEditExternal"
            @open-with="onOpenWith"
            @cd-terminal="onCdTerminal"
          />
        </main>
        <StatusBar />
      </section>

      <HostsPage v-if="store.page === 'hosts' && booted" class="page" @new-host="openNewHost" @edit-host="openEditHost" />

      <section v-if="store.page === 'sftp'" class="page sftp-page">
        <header class="page-head">
          <h1>SFTP</h1>
          <nav v-if="connectedPanes.length" class="sessions">
            <button
              v-for="c in connectedPanes"
              :key="c.pane.id"
              class="session"
              :class="{ on: sftpPane?.id === c.pane.id }"
              @click="pickSftpPane(c.tab.id, c.pane.id)"
            >
              <OsIcon :os="c.host?.os" :color="c.host?.color" :size="22" />
              <span>{{ c.tab.title }}</span>
            </button>
          </nav>
        </header>
        <div v-if="sftpPane" class="sftp-body">
          <SftpDrawer
            page
            :session-id="sftpPane.sshSessionId"
            :open="true"
            :terminal-cwd="activeCwd"
            :reload-key="sftpReloadKey"
            @edit-file="onEditFile"
            @edit-external="onEditExternal"
            @open-with="onOpenWith"
            @cd-terminal="onCdTerminal"
          />
        </div>
        <div v-else class="sftp-pick">
          <p>{{ t('sftpPage.pick') }}</p>
          <div class="pick-grid">
            <button
              v-for="h in sftpHosts"
              :key="h.id"
              class="pick"
              :class="{ busy: store.sftpConnecting === h.id }"
              :disabled="!!store.sftpConnecting"
              @click="connectForSftp(h)"
            >
              <OsIcon :os="h.os" :color="h.color" :size="34" />
              <span class="pick-main">
                <b><span class="pdot" :class="pickState(h)" />{{ h.label }}</b>
                <small>{{ h.username }}@{{ h.host }}</small>
              </span>
            </button>
          </div>
        </div>
      </section>

      <ForwardsPage v-if="store.page === 'forwards'" class="page" />

      <SettingsDialog />
    </div>

    <CommandPalette @new-host="openNewHost" @edit-host="openEditHost" />
        <HostEditor :open="editorOpen" :host="editingHost" @close="editorOpen = false" />
    <TextEditor
      :open="editorFileOpen"
      :session-id="store.activePane?.sshSessionId"
      :path="editFilePayload.path"
      :name="editFilePayload.name"
      @close="editorFileOpen = false"
      @saved="onEditorSaved"
    />
    <TransferPanel />
    <SnippetVarsDialog />
    <TooltipLayer />
    <ConfirmDialog />
    <ToastHost />
    <ZoomHud />
    <HistorySearch />
    <TmuxDialog />
    <ForwardDialog />
    <PublishKeyDialog />
    <SessionReplayDialog />
    <LockScreen v-if="store.lockLocked" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
}
.workspace {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  background: var(--bg);
}
.page {
  flex: 1;
  min-height: 0;
}
.term-page {
  display: flex;
  flex-direction: column;
}
.term-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: 100%;
  font-size: 13px;
  color: var(--text-faint);
}
.term-empty p {
  margin: 0;
}
.term-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  color: var(--text-dim);
  background: var(--bg-elev);
  border: 1px solid var(--border);
}
.sftp-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 24px 36px 28px;
}
.sessions {
  display: flex;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.session {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px 0 5px;
  border-radius: var(--r-pill);
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.session:hover {
  color: var(--text);
  background: var(--hover);
}
.session.on {
  color: var(--text);
  background: var(--selected);
}
.session :deep(.os-tile) {
  border-radius: var(--r-pill);
}
.sftp-body {
  flex: 1;
  min-height: 0;
}
.sftp-pick {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sftp-pick p {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint);
}
.pick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.pick {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  text-align: left;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-menu);
  transition: border-color 0.18s var(--ease), background 0.18s var(--ease), transform 0.18s var(--ease), box-shadow 0.18s var(--ease);
}
/* Same hover as the host cards on the 连接 page. */
.pick:hover {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--text) 3%, var(--bg-elev));
  transform: translateY(-1px);
  box-shadow: 0 10px 24px -18px rgba(0, 0, 0, 0.55);
}
.pick:active {
  transform: scale(0.99);
}
.pick:disabled {
  cursor: default;
}
.pick:disabled:not(.busy) {
  opacity: 0.55;
}
.pick.busy {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  animation: pick-busy 1.2s ease-in-out infinite;
}
@keyframes pick-busy {
  50% {
    opacity: 0.6;
  }
}
.pick-main b {
  display: flex;
  align-items: center;
  gap: 7px;
}
.pdot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--text-faint);
}
.pdot.online {
  background: var(--ok);
  box-shadow: none;
}
.pdot.offline {
  background: var(--text-faint);
  box-shadow: none;
}
.pick-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pick-main b {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}
.pick-main small {
  font-size: 12px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stage {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  background: var(--bg);
}
.main-area {
  position: relative;
  flex: 1;
  min-width: 0;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: 100%;
  color: var(--text-dim);
}
.spinner {
  width: 26px;
  height: 26px;
  border: 2.5px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.closed-banner {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  /* Above the pane chrome it overlaps — a split's focused cell (1), the
     unfocused scrim (3) and the per-pane close button (6) all sit in this same
     stacking context and would otherwise paint over the banner and swallow the
     click. Still below the terminal's search bar (60) and menu (90). */
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 16px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-dim);
}
.banner-btn {
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.banner-btn:hover {
  background: var(--accent);
  color: #fff;
}
.banner-dim {
  color: var(--text-faint);
}
.offline-banner {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 5px 12px;
  background: color-mix(in srgb, var(--warn) 18%, transparent);
  color: var(--warn);
  font-size: 12px;
  font-weight: 500;
  border-top: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
}
</style>
