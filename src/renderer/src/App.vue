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
import TabBar from './components/TabBar.vue'
import CommandPalette from './components/CommandPalette.vue'
import HostEditor from './components/HostEditor.vue'
import TextEditor from './components/TextEditor.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ToastHost from './components/ToastHost.vue'
import HistorySearch from './components/HistorySearch.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import StatusBar from './components/StatusBar.vue'
import Icon from './components/Icon.vue'
import PaneNode from './components/PaneNode.vue'
import TransferPanel from './components/TransferPanel.vue'
import SnippetVarsDialog from './components/SnippetVarsDialog.vue'
import TooltipLayer from './components/TooltipLayer.vue'
import { useI18n } from './lib/i18n'
import { collectPaneIds } from './lib/paneLayout'
import logoUrl from './assets/logo.png'
import type { Host } from '../../shared/types'

// Neither of these can be on screen at startup — a restored tab comes back
// disconnected, and the file drawer needs a live session — so keep them (and
// the whole xterm bundle behind TerminalView) out of the first-paint chunk.
// They are prefetched once the window is up, so opening one still feels instant.
const TerminalView = defineAsyncComponent(() => import('./components/TerminalView.vue'))
const SftpDrawer = defineAsyncComponent(() => import('./components/SftpDrawer.vue'))

const store = useSessions()
const { t } = useI18n()

// Show the platform's real modifier key in hints (⌘ on macOS, Ctrl elsewhere).
const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
const modKey = isMac ? '⌘' : 'Ctrl'

// Saved hosts for the welcome quick-connect, most-recently-used first.
const recentHosts = computed(() =>
  [...store.hosts]
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, 6)
)
/** The welcome list grouped by the saved host's group, preserving MRU order. */
const recentGroups = computed(() => {
  const groups: { group: string; hosts: Host[] }[] = []
  for (const h of recentHosts.value) {
    const g = h.group?.trim() || t('app.ungrouped')
    let grp = groups.find((x) => x.group === g)
    if (!grp) {
      grp = { group: g, hosts: [] }
      groups.push(grp)
    }
    grp.hosts.push(h)
  }
  return groups
})
async function onQuickConnect(h: Host): Promise<void> {
  if ((await store.quickConnect(h)) === 'needs-password') store.togglePalette(true)
}

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
  // Never pull focus out of a modal: the palette, settings, host editor and
  // confirm dialog all bind Esc/Enter on their own element, so taking focus
  // away silently disables those keys while the dialog is still up.
  if (document.querySelector('.overlay')) return
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

let zoomSaveTimer: ReturnType<typeof setTimeout> | null = null
function setZoom(level: number): void {
  const clamped = Math.max(-3, Math.min(5, level))
  window.api.zoom.set(clamped)
  // Apply immediately but debounce the persist: a Ctrl+wheel gesture fires many
  // notches, and each write is a full re-read+rewrite of settings.json that a
  // second instance could be reading at the same moment.
  if (zoomSaveTimer) clearTimeout(zoomSaveTimer)
  zoomSaveTimer = setTimeout(() => void window.api.settings.set('zoom', clamped), 300)
}
function bumpZoom(delta: number): void {
  setZoom(window.api.zoom.get() + delta)
}

function onWheel(e: WheelEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return
  // Ctrl + wheel zooms the whole UI; intercept before the terminal scrolls.
  e.preventDefault()
  e.stopPropagation()
  bumpZoom(e.deltaY < 0 ? 0.5 : -0.5)
}

function onGlobalKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  const inTerminal = !!t?.closest?.('.xterm')
  const inEditable =
    !inTerminal &&
    (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable === true)
  // Don't hijack typing in form fields (editors, rename, search…).
  if (inEditable) return

  const mod = e.ctrlKey || e.metaKey
  if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
    // Split the active tab side-by-side (a second session to the same target).
    e.preventDefault()
    if (store.active && store.activePane?.status === 'connected') {
      void store.splitPane(store.active.id, 'row')
    }
  } else if (mod && e.shiftKey && (e.key === '\\' || e.key === '`')) {
    // Split the active pane stacked (a second session above/below) for a 2×2.
    e.preventDefault()
    if (store.active && store.activePane?.status === 'connected') {
      void store.splitPane(store.active.id, 'col')
    }
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'w') {
    // Close just the focused pane (falls back to closing the tab if it's the last).
    e.preventDefault()
    if (store.activePane) store.closePane(store.activePane.id)
  } else if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    store.togglePalette()
  } else if (mod && e.key.toLowerCase() === 't') {
    e.preventDefault()
    store.togglePalette(true)
  } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'w') {
    // Ctrl+W is werase in a shell, so don't steal it from a live session. A
    // closed one is different: nothing receives the keystroke, the dead
    // terminal still holds focus, and the banner promises Ctrl+W closes the
    // tab — so it has to work there.
    if (inTerminal && store.activePane?.status === 'connected') return
    if (store.activeId) {
      e.preventDefault()
      store.closeTab(store.activeId)
    }
  } else if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault()
    store.nextTab(e.shiftKey ? -1 : 1)
  } else if (mod && !e.shiftKey && e.key >= '1' && e.key <= '9') {
    // Ctrl+1..8 jump to that tab; Ctrl+9 to the last one, as browsers do.
    e.preventDefault()
    const n = Number(e.key)
    const tab = n === 9 ? store.tabs[store.tabs.length - 1] : store.tabs[n - 1]
    if (tab) store.setActive(tab.id)
  } else if (mod && (e.key === '/' || e.key === '?')) {
    // Ctrl+/ (and Ctrl+? on the same physical key) opens settings straight on
    // the shortcut list.
    e.preventDefault()
    store.toggleSettings(true, 'keys')
  } else if (mod && !e.shiftKey && e.key === ',') {
    e.preventDefault()
    store.toggleSettings()
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
    // File drawer (SFTP) — the same toggle as the folder button.
    e.preventDefault()
    store.toggleSftp()
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    store.togglePalette()
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
    // Cross-session output history search.
    e.preventDefault()
    store.toggleHistory()
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
    // Cycle the focused pane of a split. Alt+Arrow would be the usual key,
    // but the shell needs it for word-wise cursor movement. Walk the layout in
    // visual (DFS) order so focus follows the on-screen arrangement.
    e.preventDefault()
    const tab = store.active
    const order = tab ? collectPaneIds(tab.layout) : []
    if (order.length > 1) {
      const i = order.indexOf(tab!.activePaneId)
      const next = order[(i + 1) % order.length]
      store.setActivePane(tab!.id, next)
    }
  } else if (mod && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    bumpZoom(0.5)
  } else if (mod && e.key === '-') {
    e.preventDefault()
    bumpZoom(-0.5)
  } else if (mod && e.key === '0') {
    e.preventDefault()
    setZoom(0)
  }
}

let offEvent: (() => void) | null = null

onMounted(async () => {
  const savedZoom = Number(window.api.prefs.zoom)
  if (!Number.isNaN(savedZoom) && savedZoom !== 0) window.api.zoom.set(savedZoom)
  await Promise.all([
    store.loadHosts(),
    store.loadSettings(),
    store.loadSnippets(),
    store.loadKnownHosts(),
    store.loadSftpBookmarks(),
    store.loadSftpRecent(),
    store.loadSnapshots()
  ])
  await store.restoreSavedTabs()
  store.initSftpProgress()
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('wheel', onWheel, { passive: false, capture: true })
  offEvent = window.api.ssh.onEvent((ev) => {
    store.applyEvent(ev.sessionId, ev.status, ev.message)
  })
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
  offEvent?.()
})
</script>

<template>
  <div class="app">
    <TabBar />

    <main class="stage">
      <div class="main-area">
      <!-- Live terminals: kept mounted, shown by visibility. A tab holds a
           nested split tree of panes rendered recursively. -->
      <template v-for="tab in store.tabs" :key="tab.id">
        <PaneNode
          v-show="tab.id === store.activeId"
          :node="tab.layout"
          :tab="tab"
          :root="true"
          :path="[]"
          :tab-active="tab.id === store.activeId"
          :mod-key="modKey"
          @cwd="onCwd"
        />
      </template>

      <!-- Empty state -->
      <div v-if="!store.tabs.length" class="welcome">
        <div class="hero">
          <img class="logo" :src="logoUrl" alt="X-SSH" />
          <h1>X-SSH</h1>
          <p class="tagline">{{ t('app.tagline') }}</p>
        </div>

        <div class="dock">
          <button class="cta" @click="store.togglePalette(true)">
            <span class="cta-left"><Icon name="plus" :size="16" /><span>{{ t('app.newConn') }}</span></span>
            <span class="cta-keys"><span class="kbd">{{ modKey }}</span><span class="kbd">K</span></span>
          </button>

          <div v-if="recentHosts.length" class="saved">
            <template v-for="grp in recentGroups" :key="grp.group">
              <div class="saved-label">{{ grp.group }}</div>
              <button
                v-for="h in grp.hosts"
                :key="h.id"
                class="host-row"
                @click="onQuickConnect(h)"
              >
                <span class="h-icon" :style="{ color: h.color || 'var(--accent)' }">
                  <Icon name="server" :size="17" />
                </span>
                <span class="h-main">
                  <span class="h-label">{{ h.label }}</span>
                  <span class="h-sub">{{ h.username }}@{{ h.host }}<template v-if="h.port !== 22">:{{ h.port }}</template></span>
                </span>
                <Icon name="arrow-right" :size="15" class="h-go" />
              </button>
            </template>
          </div>
          <p v-else class="hint">
            {{ t('app.hintBefore') }}<code>user@host</code>{{ t('app.hintAfter') }}
          </p>
        </div>
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
        v-if="store.sftpOpen && store.activePane?.status === 'connected'"
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
    <SettingsDialog />
    <TransferPanel />
    <SnippetVarsDialog />
    <TooltipLayer />
    <ConfirmDialog />
    <ToastHost />
    <HistorySearch />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
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
.idle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
}
.idle-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(300px, 86vw);
}
.idle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--accent);
  margin-bottom: 16px;
}
.idle-title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}
.idle-status {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.03em;
  color: var(--danger);
}
.idle-status.warn {
  color: var(--warn);
}
.idle-msg {
  margin-top: 8px;
  max-width: 260px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-faint);
  text-align: center;
}
.idle-sub {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.idle-connect {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 70%;
  height: 42px;
  margin-top: 26px;
  border-radius: var(--radius);
  white-space: nowrap;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
  transition: border-color 0.15s, background 0.15s;
}
.idle-connect:hover {
  border-color: var(--accent);
  background: var(--bg-elev-2);
}
.idle-close {
  margin-top: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  color: var(--text-faint);
  border-radius: 6px;
  transition: color 0.14s;
}
.idle-close:hover {
  color: var(--text-dim);
}
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* `safe`: once the saved-host list makes the content taller than the pane,
     plain `center` splits the overflow across BOTH edges — the logo rides up
     over the tab bar and the top is unreachable, because a scroll container
     can't scroll above its origin. `safe` falls back to flex-start in exactly
     that case, and overflow-y keeps the rest reachable. */
  justify-content: safe center;
  overflow-y: auto;
  gap: 30px;
  height: 100%;
  text-align: center;
  padding: 24px;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.logo {
  width: 84px;
  height: 84px;
  margin-bottom: 8px;
  -webkit-user-drag: none;
}
.welcome h1 {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.tagline {
  color: var(--text-dim);
  font-size: 13.5px;
}
.dock {
  width: min(360px, 84vw);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px 12px 16px;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  font-size: 14px;
  transition: border-color 0.15s, background 0.15s, transform 0.05s;
}
.cta-left {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--text);
}
.cta:hover {
  border-color: var(--accent);
  background: var(--bg-elev-2);
}
.cta:active {
  transform: translateY(1px);
}
.cta-keys {
  display: flex;
  gap: 3px;
}
.saved {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.saved-label {
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 4px 6px;
}
.host-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background 0.13s;
}
.host-row:hover {
  background: var(--bg-elev);
}
.h-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--bg-elev-2);
}
.h-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.h-label {
  font-size: 13.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.h-sub {
  font-size: 11.5px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.h-go {
  flex: none;
  color: var(--text-faint);
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 0.13s, transform 0.13s;
}
.host-row:hover .h-go {
  opacity: 1;
  transform: translateX(0);
  color: var(--accent);
}
.welcome .hint {
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
}
.welcome code {
  font-family: var(--font-mono);
  color: var(--text-dim);
  background: var(--bg-elev-2);
  padding: 1px 6px;
  border-radius: 4px;
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
</style>
