<script setup lang="ts">
import { reactive, ref, computed, nextTick } from 'vue'
import { useSessions, type Tab } from '../stores/sessions'
import { useTheme } from '../composables/theme'
import { useI18n } from '../lib/i18n'
import { isMac } from '../composables/platform'
import { useZoom } from '../composables/zoom'
import Icon from './Icon.vue'

const store = useSessions()
const { mode, toggle } = useTheme()
const { t } = useI18n()
const { factor } = useZoom()
const modKey = isMac ? '⌘' : 'Ctrl'

// The traffic lights are drawn by the OS at a fixed size, so a zoomed UI would
// leave the tab bar out of step with them. Counter-scale just the bar so its
// row stays glued to the lights whatever the app zoom is.
const barStyle = computed(() => (isMac ? { zoom: 1 / factor.value } : {}))
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

function openTabMenu(e: MouseEvent, id: string): void {
  e.preventDefault()
  menu.tabId = id
  menu.x = Math.min(e.clientX, window.innerWidth - 168)
  menu.y = e.clientY
  menu.open = true
}
function run(action: (id: string) => void): void {
  action(menu.tabId)
  menu.open = false
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
}
function doSplit(dir: 'row' | 'col'): void {
  layoutMenu.open = false
  if (store.active) store.splitPane(store.active.id, dir)
}
function applyPreset(rows: number, cols: number): void {
  layoutMenu.open = false
  void store.applyLayoutPreset(rows, cols)
}

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
function commitRename(): void {
  if (editingId.value) store.renameTab(editingId.value, editingText.value)
  editingId.value = ''
}
function cancelRename(): void {
  editingId.value = ''
}
</script>

<template>
  <div class="tabbar" :class="{ mac: isMac }" :style="barStyle">
    <div class="tabs">
      <div
        v-for="tab in visibleTabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === store.activeId, dragging: dragging === tab.id, 'drop-target': dropTarget === tab.id }"
        draggable="true"
        role="tab"
        @dragstart="dragging = tab.id"
        @dragend="dragging = ''; dropTarget = ''"
        @dragover.prevent="onDragOver(tab.id)"
        @drop.prevent="onDrop(tab.id)"
        @click="store.setActive(tab.id)"
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
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <span v-else class="label">{{ tab.title }}</span>
        <span class="close" :title="t('tabbar.close')" @click.stop="store.closeTabSafe(tab.id)"><Icon name="close" :size="13" /></span>
      </div>
    </div>
    <div v-if="filterOpen" class="filter-box">
      <Icon name="search" :size="14" />
      <input
        ref="filterEl"
        v-model="filterQuery"
        class="filter-input"
        :placeholder="t('tabbar.filter')"
        spellcheck="false"
        @keydown.esc.prevent="toggleFilter"
      />
      <span class="filter-count">{{ visibleTabs.length }}/{{ store.tabs.length }}</span>
    </div>
    <button class="tool" :class="{ on: filterOpen }" :title="t('tabbar.filter')" @click="toggleFilter">
      <Icon name="search" :size="16" />
    </button>
    <button class="new" :title="t('tabbar.newConn', { key: `${modKey}+K` })" @click="store.togglePalette(true)">
      <Icon name="plus" :size="17" />
    </button>
    <div class="drag-spacer" />
    <button
      class="tool"
      :class="{ on: layoutMenu.open }"
      :title="t('tabbar.layout')"
      @click.stop="openLayoutMenu"
    >
      <Icon name="layout" :size="16" />
    </button>
    <button
      v-if="store.activePane?.status === 'connected'"
      class="tool"
      :class="{ on: store.sftpOpen }"
      :title="t('tabbar.sftp')"
      @click="store.toggleSftp()"
    >
      <Icon name="folder" :size="16" />
    </button>
    <button
      class="tool"
      :class="{ on: store.settingsOpen }"
      :title="t('tabbar.settings', { key: `${modKey}+,` })"
      @click="store.toggleSettings()"
    >
      <Icon name="settings" :size="16" />
    </button>
    <button
      class="tool"
      :title="mode === 'dark' ? t('tabbar.toLight') : t('tabbar.toDark')"
      @click="toggle"
    >
      <Icon :name="mode === 'dark' ? 'sun' : 'moon'" :size="16" />
    </button>
  </div>

  <div v-if="layoutMenu.open" class="ctx-overlay" @mousedown="layoutMenu.open = false" @contextmenu.prevent="layoutMenu.open = false">
    <div class="ctx layout-menu" :style="{ left: layoutMenu.x + 'px', top: layoutMenu.y + 'px' }" @mousedown.stop>
      <button :disabled="!canLayout" @click="doSplit('row')">{{ t('tabbar.splitAction') }}</button>
      <button :disabled="!canLayout" @click="doSplit('col')">{{ t('tabbar.splitColAction') }}</button>
      <div class="sep" />
      <button v-for="p in presets" :key="p.label" :disabled="!canLayout" @click="applyPreset(p.rows, p.cols)">
        {{ t('tabbar.preset', { n: p.label }) }}
      </button>
    </div>
  </div>

  <div v-if="menu.open" class="ctx-overlay" @mousedown="menu.open = false" @contextmenu.prevent="menu.open = false">
    <div class="ctx" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @mousedown.stop>
      <button @click="run(store.reconnectTab)">{{ t('tabbar.reconnect') }}</button>
      <button @click="run(store.duplicate)">{{ t('tabbar.duplicate') }}</button>
      <button @click="startRename">{{ t('tabbar.rename') }}</button>
      <div class="sep" />
      <button @click="run(store.closeTabSafe)">{{ t('tabbar.closeTab') }}</button>
      <button :disabled="store.tabs.length < 2" @click="run(store.closeOthers)">{{ t('tabbar.closeOthers') }}</button>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 8px;
  gap: 6px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
}
/* Reserve room for the native macOS traffic lights (hiddenInset title bar). */
.tabbar.mac {
  padding-left: 72px;
}
.tabbar.mac > * {
  position: relative;
  top: 1px;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
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
  height: 28px;
  padding: 0 8px 0 10px;
  max-width: 190px;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  border: 1px solid transparent;
  box-sizing: border-box;
  cursor: default;
  transition: background 0.12s, color 0.12s;
}
.tab:hover {
  background: var(--bg-elev-2);
}
.tab.active {
  background: var(--bg-elev-2);
  color: var(--text);
  border-color: var(--border);
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
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.tcolor {
  flex: none;
  width: 3px;
  height: 14px;
  border-radius: 2px;
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
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
.label {
  font-size: 12.5px;
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
  font-size: 12px;
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
  opacity: 0;
  transition: opacity 0.14s, background 0.14s, color 0.14s;
}
.tab:hover .close,
.tab.active .close {
  opacity: 1;
}
.close:hover {
  background: var(--border-strong);
  color: var(--text);
}
.filter-box {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text-faint);
  -webkit-app-region: no-drag;
}
.filter-input {
  width: 128px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 12px;
}
.filter-input::placeholder {
  color: var(--text-faint);
}
.filter-count {
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.new,
.tool {  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--text-dim);
  border-radius: var(--radius-sm);
  transition: background 0.14s, color 0.14s;
  -webkit-app-region: no-drag;
}
.new:hover,
.tool:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.tool.on {
  background: var(--accent-soft);
  color: var(--accent);
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
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.ctx button {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 13px;
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
