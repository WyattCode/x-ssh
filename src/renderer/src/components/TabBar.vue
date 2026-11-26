<script setup lang="ts">
import { reactive, ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useSessions, type Tab } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { isMac } from '../composables/platform'
import { useZoom } from '../composables/zoom'
import { isImeKey } from '../lib/ime'
import { hostEnv } from '../lib/hostEnv'
import type { Host } from '../../../shared/types'
import Icon from './Icon.vue'
import SplitHostPicker from './SplitHostPicker.vue'

const store = useSessions()
const { t } = useI18n()
const modKey = isMac ? '⌘' : 'Ctrl'

// The traffic lights are drawn by the OS at a fixed size; the main process
// moves them to the zoomed band's centre (see src/main/macLights.ts). `--zf`
// below keeps the focus-mode inset at a screen-point floor: the buttons' x is
// fixed at 13.0…64.6 pt while CSS px shrink with the page.
const { factor } = useZoom()
const underLights = computed(() => isMac && store.termSidebarHidden)
/** Layout/split operations need a connected active tab. */
const canLayout = computed(() => store.activePane?.status === 'connected')

// ---- Tab search / filter ----
const filterOpen = ref(false)
const filterQuery = ref('')
const filterEl = ref<HTMLInputElement>()
function toggleFilter(): void {
  filterOpen.value = !filterOpen.value
  if (filterOpen.value) nextTick(() => filterEl.value?.focus())
  else filterQuery.value = ''
}
/** Tabs matching the filter (by title or the underpinning host label). */
const visibleTabs = computed(() => {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return store.tabs
  return store.tabs.filter((tab) => {
    if (tab.title.toLowerCase().includes(q)) return true
    if (tab.hostId) {
      const h = store.hosts.find((x) => x.id === tab.hostId)
      if (h && (`${h.label} ${h.username}@${h.host}`.toLowerCase().includes(q))) return true
    }
    return false
  })
})

// ---- Keyboard ----
// The strip is one Tab stop: the active tab (the first one when a filter hides it), and the
// arrows move along it, switching as they go. Tabs used to be reachable by mouse only.
const stripEl = ref<HTMLElement>()
const stopId = computed(() =>
  visibleTabs.value.some((x) => x.id === store.activeId) ? store.activeId : (visibleTabs.value[0]?.id ?? '')
)
function onTabKey(e: KeyboardEvent, id: string): void {
  // Keys typed in the rename box, or on the close button, are theirs.
  if (e.target !== e.currentTarget || isImeKey(e)) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    store.setActive(id)
    store.focusTerminal()
    return
  }
  const list = visibleTabs.value
  const i = list.findIndex((x) => x.id === id)
  const to =
    e.key === 'ArrowRight' ? (i + 1) % list.length
    : e.key === 'ArrowLeft' ? (i - 1 + list.length) % list.length
    : e.key === 'Home' ? 0
    : e.key === 'End' ? list.length - 1
    : -1
  if (to < 0 || i < 0) return
  e.preventDefault()
  store.setActive(list[to].id)
  nextTick(() => stripEl.value?.querySelectorAll<HTMLElement>('.tab')[to]?.focus())
}

const dragging = ref('')
const dropTarget = ref('')
function onDragOver(tabId: string): void {
  if (dragging.value && dragging.value !== tabId) dropTarget.value = tabId
}
function onDrop(targetId: string): void {
  if (dragging.value) store.moveTab(dragging.value, targetId)
  dragging.value = ''
  dropTarget.value = ''
}

// A tab's dot reflects the most salient pane state (connecting > connected >
// error > closed) across its split panes.
function tabStatus(tab: Tab): string {
  const s = tab.panes.map((p) => p.status)
  if (s.includes('connecting')) return 'connecting'
  if (s.includes('connected')) return 'connected'
  if (s.includes('error')) return 'error'
  return 'closed'
}
const statusColor = (s: string): string =>
  s === 'connected'
    ? 'var(--ok)'
    : s === 'connecting'
      ? 'var(--warn)'
      : s === 'error'
        ? 'var(--danger)'
        : 'var(--text-faint)'

// Per-tab right-click menu.
const menu = reactive({ open: false, x: 0, y: 0, tabId: '' })
const layoutMenuEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)

/** Pull a just-opened fixed menu fully inside the window using its real
 *  rendered size. The tab menu used to clamp with a guessed 168px width and
 *  never touched y at all: a wide locale ("Close others…") overflowed right,
 *  and on a short window the last items sat off-screen. Same approach as the
 *  terminal's context menu. */
function clampMenu(pos: { x: number; y: number }, el: HTMLElement | null): void {
  const r = el?.getBoundingClientRect()
  if (!r) return
  pos.x = Math.max(8, Math.min(pos.x, window.innerWidth - r.width - 8))
  pos.y = Math.max(8, Math.min(pos.y, window.innerHeight - r.height - 8))
}

function openTabMenu(e: MouseEvent, id: string): void {
  e.preventDefault()
  menu.tabId = id
  menu.x = e.clientX
  menu.y = e.clientY
  menu.open = true
  void nextTick(() => clampMenu(menu, menuEl.value))
}
function run(action: (id: string) => void): void {
  action(menu.tabId)
  menu.open = false
}
/** Close all is not per-tab, so it can't go through `run` (which passes the id). */
function closeAllTabs(): void {
  menu.open = false
  void store.closeAll()
}

// ---- Split / layout presets ----
const layoutMenu = reactive({ open: false, x: 0, y: 0 })
const presets: { label: string; rows: number; cols: number }[] = [
  { label: '2', rows: 1, cols: 2 },
  { label: '3', rows: 1, cols: 3 },
  { label: '4', rows: 1, cols: 4 },
  { label: '2×2', rows: 2, cols: 2 }
]
function openLayoutMenu(e: MouseEvent): void {
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
  layoutMenu.x = Math.max(8, b.right - 184)
  layoutMenu.y = b.bottom + 12
  layoutMenu.open = true
  void nextTick(() => clampMenu(layoutMenu, layoutMenuEl.value))
}
function doSplit(dir: 'row' | 'col'): void {
  layoutMenu.open = false
  if (store.active) store.splitPane(store.active.id, dir)
}
/** "Side by side with another host": the layout menu hands over to the host picker. */
const picker = reactive({ open: false, x: 0, y: 0 })
function openPicker(): void {
  picker.x = layoutMenu.x
  picker.y = layoutMenu.y
  layoutMenu.open = false
  picker.open = true
}
function applyPreset(rows: number, cols: number): void {
  layoutMenu.open = false
  void store.applyLayoutPreset(rows, cols)
}

/** Esc closes an open menu. Neither menu had a key handler, so Esc did nothing to them — and
 *  with the terminal focused it went to the remote shell instead. Caught in the capture phase
 *  and stopped there, so the key that closes a menu is not also typed into the session. */
function onMenuEsc(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || isImeKey(e)) return
  if (!menu.open && !layoutMenu.open) return
  e.preventDefault()
  e.stopPropagation()
  menu.open = false
  layoutMenu.open = false
}
onMounted(() => window.addEventListener('keydown', onMenuEsc, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onMenuEsc, true))

/** Production hosts carry a warm tag in their tab: the one environment that
 *  must not be mistaken for another. */
function tabHost(tab: Tab): Host | undefined {
  return tab.hostId ? store.hosts.find((h) => h.id === tab.hostId) : undefined
}
const isProd = (tab: Tab): boolean => !!hostEnv(tabHost(tab))?.prod
const prodLabel = (tab: Tab): string => hostEnv(tabHost(tab))?.label ?? ''

/** A tab's own accent color (from its saved host), if any. */
function hostColor(tab: Tab): string | undefined {
  return tab.hostId ? store.hosts.find((h) => h.id === tab.hostId)?.color : undefined
}

// ---- Inline rename ----
const editingId = ref('')
const editingText = ref('')
const editEl = ref<HTMLInputElement>()
function startRename(): void {
  const tab = store.tabs.find((t) => t.id === menu.tabId)
  if (!tab) return
  menu.open = false
  editingText.value = tab.title
  editingId.value = tab.id
  nextTick(() => {
    editEl.value?.focus()
    editEl.value?.select()
  })
}
function commitRename(e?: Event): void {
  // The Enter that commits an IME candidate belongs to the input method: taking
  // it here would rename the tab to the text the candidate had not replaced yet.
  // `.prevent` in the template would run before this check and swallow the
  // candidate, so the keydown is bound plainly and cancelled here.
  if (isImeKey(e)) return
  if (e && 'key' in e) e.preventDefault()
  if (editingId.value) store.renameTab(editingId.value, editingText.value)
  editingId.value = ''
}
function cancelRename(): void {
  editingId.value = ''
}
</script>

<template>
  <div class="tabbar" :class="{ mac: underLights }" :style="isMac ? { '--zf': factor } : undefined">
    <!-- Fold / unfold the host rail (Ctrl+B outside a live terminal). -->
    <button
      class="rail-toggle"
      :class="{ on: !store.termSidebarHidden }"
      :title="store.termSidebarHidden ? t('nav.exitFocus') : t('rail.fold')"
      :aria-label="store.termSidebarHidden ? t('nav.exitFocus') : t('rail.fold')"
      @click="store.setTermSidebarHidden(!store.termSidebarHidden)"
    >
      <Icon name="sidebar" :ink="10.1" :weight="1.3" />
    </button>
    <div ref="stripEl" class="tabs" role="tablist">
      <div
        v-for="tab in visibleTabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === store.activeId, dragging: dragging === tab.id, 'drop-target': dropTarget === tab.id }"
        draggable="true"
        role="tab"
        :aria-selected="tab.id === store.activeId"
        :tabindex="tab.id === stopId ? 0 : -1"
        @keydown="onTabKey($event, tab.id)"
        @dragstart="dragging = tab.id"
        @dragend="dragging = ''; dropTarget = ''"
        @dragover.prevent="onDragOver(tab.id)"
        @drop.prevent="onDrop(tab.id)"
        @click="store.setActive(tab.id); store.focusTerminal()"
        @mousedown.middle.prevent="store.closeTabSafe(tab.id)"
        @contextmenu="openTabMenu($event, tab.id)"
      >
        <span
          v-if="hostColor(tab)"
          class="tcolor"
          :style="{ background: hostColor(tab) }"
        />
        <span class="dot" :style="{ background: statusColor(tabStatus(tab)) }" />
        <span v-if="tab.panes.length > 1" class="pane-count">{{ tab.panes.length }}</span>
        <input
          v-if="editingId === tab.id"
          ref="editEl"
          v-model="editingText"
          class="rename"
          spellcheck="false"
          @click.stop
          @keydown.enter="commitRename($event)"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <span v-else class="label">{{ tab.title }}</span>
        <span v-if="isProd(tab)" class="prod">{{ prodLabel(tab) }}</span>
        <span v-if="tabStatus(tab) === 'connected'" class="cursor" :class="{ off: tab.id !== store.activeId }" aria-hidden="true" />
        <span class="close" :title="t('tabbar.close')" @click.stop="store.closeTabSafe(tab.id)"><Icon name="close" :size="13" /></span>
      </div>
    </div>
    <button class="new" :title="t('tabbar.newConn', { key: `${modKey}+K` })" :aria-label="t('tabbar.newConn', { key: `${modKey}+K` })" @click="store.openNewTabPalette()">
      <Icon name="plus" :ink="10.1" :weight="1.3" />
    </button>
    <div class="drag-spacer" />
    <div class="right-tools">
      <!-- Tab search and layouts only mean something once there are tabs. -->
      <button v-if="store.tabs.length" class="tool" :class="{ on: filterOpen }" :title="t('tabbar.filter')" :aria-label="t('tabbar.filter')" @click="toggleFilter">
        <Icon name="search" :ink="10.1" :weight="1.3" />
      </button>
      <!-- No second magnifier in the box: the (green) button beside it is the icon. -->
      <div v-if="filterOpen" class="filter-box">
        <input
          ref="filterEl"
          v-model="filterQuery"
          class="filter-input"
          :placeholder="t('tabbar.filter')"
          spellcheck="false"
          @keydown.esc.prevent="toggleFilter"
        />
        <!-- A count only says something once there is a filter. -->
        <span v-if="filterQuery.trim()" class="filter-count">{{ visibleTabs.length }}/{{ store.tabs.length }}</span>
      </div>
      <button
        v-if="store.tabs.length"
        class="tool"
        :class="{ on: layoutMenu.open }"
        :title="t('tabbar.layout')" :aria-label="t('tabbar.layout')"
        @click.stop="openLayoutMenu"
      >
        <Icon name="layout" :ink="10.1" :weight="1.3" />
      </button>
      <button
        v-if="store.activePane?.status === 'connected'"
        class="tool"
        :class="{ on: store.sftpOpen }"
        :title="t('tabbar.sftp')" :aria-label="t('tabbar.sftp')"
        @click="store.toggleSftp()"
      >
        <Icon name="folder" :ink="10.1" :weight="1.3" />
      </button>

    </div>
  </div>

  <div v-if="layoutMenu.open" class="ctx-overlay" @mousedown="layoutMenu.open = false" @contextmenu.prevent="layoutMenu.open = false">
    <div ref="layoutMenuEl" class="ctx layout-menu" :style="{ left: layoutMenu.x + 'px', top: layoutMenu.y + 'px' }" @mousedown.stop>
      <button :disabled="!canLayout" @click="doSplit('row')">{{ t('tabbar.splitAction') }}</button>
      <button :disabled="!canLayout" @click="doSplit('col')">{{ t('tabbar.splitColAction') }}</button>
      <button :disabled="!canLayout" @click="openPicker">{{ t('cmp.add') }}</button>
      <div class="sep" />
      <button v-for="p in presets" :key="p.label" :disabled="!canLayout" @click="applyPreset(p.rows, p.cols)">
        {{ t('tabbar.preset', { n: p.label }) }}
      </button>
    </div>
  </div>

  <SplitHostPicker :open="picker.open" :x="picker.x" :y="picker.y" @close="picker.open = false" />

  <div v-if="menu.open" class="ctx-overlay" @mousedown="menu.open = false" @contextmenu.prevent="menu.open = false">
    <div ref="menuEl" class="ctx" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @mousedown.stop>
      <button @click="run(store.reconnectTab)">{{ t('tabbar.reconnect') }}</button>
      <button @click="run(store.duplicate)">{{ t('tabbar.duplicate') }}</button>
      <button @click="startRename">{{ t('tabbar.rename') }}</button>
      <div class="sep" />
      <button @click="run(store.closeTabSafe)">{{ t('tabbar.closeTab') }}</button>
      <button :disabled="store.tabs.length < 2" @click="run(store.closeOthers)">{{ t('tabbar.closeOthers') }}</button>
      <button :disabled="store.tabs.length < 1" @click="closeAllTabs">{{ t('tabbar.closeAll') }}</button>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: center;
  height: var(--band-top);
  padding: 0;
  gap: 0;
  font-family: var(--font-chrome);
  background: var(--chrome);
  /* The hairline is drawn inside the bar's last row, not as a border, so the bar's content is the
     full 40px and its icons sit on the same centre line as the system's caption buttons. */
  box-shadow: inset 0 -1px 0 var(--chrome-line);
  -webkit-app-region: drag;
}
.rail-toggle {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 100%;
  /* The chrome icons are drawn as bright as the system's own caption buttons beside them. */
  color: var(--text);
  border-right: 1px solid var(--chrome-line);
  -webkit-app-region: no-drag;
}
.rail-toggle:hover,
.rail-toggle.on {
  color: var(--text);
}
.prod {
  flex: none;
  font-size: 12px;
  color: var(--prod);
}
/* The blinking block after the active host, as in the phone apps. */
.cursor {
  flex: none;
  width: 6px;
  height: 12px;
  border-radius: 1px;
  background: var(--cursor);
  animation: cur-blink 1.1s steps(1) infinite;
}
/* Only the active tab blinks; the others keep the space so the tabs do not
   change width when the selection moves. */
.cursor.off {
  visibility: hidden;
  animation: none;
}
@keyframes cur-blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cursor {
    animation: none;
  }
}
/* The focus-mode inset that clears the OS buttons lives in styles/global.css
   (`:root.mac .no-sidebar .tabbar`), whose selector outranks this one — keep the
   screen-point floor there so there is only one source of truth. The `--zf` this
   component sets on its root is what that rule divides by. */
.tabs {
  height: 100%;
}
.tabbar.mac > * {
  position: relative;
  top: 1px;
}
.tabs {
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-app-region: no-drag;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 6px 0 14px;
  max-width: 220px;
  color: var(--text-dim);
  border-right: 1px solid var(--chrome-line);
  box-sizing: border-box;
  cursor: default;
  transition: background 0.12s, color 0.12s;
}
.tab:hover {
  background: var(--hover);
}
/* Selected: the tab melts into the terminal below it (same pure black). */
.tab.active {
  background: var(--console);
  color: var(--text);
  animation: tab-in 0.4s cubic-bezier(0.3, 1.35, 0.5, 1);
}
@keyframes tab-in {
  from {
    opacity: 0.4;
    transform: translateY(5px);
  }
}
.tab.dragging {
  opacity: 0.5;
}
.tab.drop-target {
  box-shadow: 0 0 0 1px var(--accent) inset;
}
.tab.drop-target::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: var(--radius-sm);
  border: 1px dashed var(--accent);
}
.tab {
  position: relative;
  /* Tabs give up width (labels ellipsize) before the strip starts to scroll. */
  min-width: 96px;
}
.new,
.tool {
  flex: none;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
/* The host's own colour, as a hairline along the tab's foot (not another marker
   beside the status dot and the cursor). */
.tcolor {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  opacity: 0.9;
}
.pane-count {
  flex: none;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
.label {
  min-width: 0;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rename {
  width: 110px;
  height: 20px;
  padding: 0 5px;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: var(--text-faint);
  transition: background 0.14s, color 0.14s;
}
.close:hover {
  background: var(--border-strong);
  color: var(--text);
}
.filter-box {
  display: flex;
  align-items: center;
  gap: 5px;
  /* A field like the host dialog's: no fill, a hairline frame; symmetric to its neighbours. */
  height: 26px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-faint);
  -webkit-app-region: no-drag;
}
.filter-box:hover {
  border-color: var(--text-faint);
}
.filter-box:focus-within {
  border-color: var(--text);
}
.filter-input {
  width: 150px;
  font-family: var(--font-chrome);
  caret-color: var(--cursor);
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 13px;
}
.filter-input::placeholder {
  color: var(--text-faint);
}
.filter-count {
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.new,
.tool {  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--text);
  border-radius: var(--radius-sm);
  transition: background 0.14s, color 0.14s;
  -webkit-app-region: no-drag;
}
/* The tools are icons only: cells of the bar's own height, one hairline's worth of nothing
   between them, so every icon sits on the bar's centre line. */
.tool {
  width: var(--band-top);
  height: 100%;
  border-radius: 0;
}
.right-tools {
  display: flex;
  align-items: center;
  height: 100%;
  -webkit-app-region: no-drag;
  flex: none;
}
.tool:hover {
  color: var(--text);
}
/* The highlight is the same rounded 28px tile as the new-tab button, not the whole cell: a
   full-height square with hard corners touched the bar's top and bottom lines. It is the
   tile for hover and for the open state alike. */
.tool {
  position: relative;
  isolation: isolate;
}
.tool::before {
  content: '';
  position: absolute;
  inset: 6px;
  z-index: -1;
  border-radius: var(--radius-sm);
  transition: background 0.14s;
}
.tool:hover::before,
.tool.on::before {
  background: var(--hover);
}
.tool.on:hover {
  color: var(--cursor);
}
.tool.on {
  color: var(--cursor);
}
/* Keyboard focus on a full-height cell: the default ring sits 2px OUTSIDE the box, so its
   top and bottom fell outside the bar and only two white bars were left beside the icon.
   Draw it inside instead, as the same rounded tile the new-tab button is. */
.tool:focus-visible,
.rail-toggle:focus-visible {
  /* Same weight and colour as every other button's ring, only drawn inward. */
  outline: 2px solid var(--accent);
  outline-offset: -6px;
  border-radius: 12px;
}
/* The new-tab button: the rounded square tile, with room around it so it is not joined to the last tab. */
.new {
  width: 28px;
  height: 28px;
  margin: 0 16px 0 14px;
  border-radius: var(--radius-sm);
}
.new:hover {
  background: var(--hover);
  color: var(--text);
}
.new:active {
  background: var(--selected);
}
.drag-spacer {
  flex: 1;
  height: 100%;
}
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 95;
}
.ctx {
  position: fixed;
  min-width: 152px;
  padding: 5px;
  background-color: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-menu);
  box-shadow: var(--shadow);
}
.ctx button {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-item);
  font-size: 14px;
  color: var(--text);
  text-align: left;
}
.ctx button:hover:not(:disabled) {
  background: var(--accent-soft);
}
.ctx button:disabled {
  color: var(--text-faint);
  cursor: default;
}
.ctx.layout-menu {
  width: 184px;
}
.ctx .sep {
  height: 1px;
  margin: 5px 4px;
  background: var(--border);
}
</style>
