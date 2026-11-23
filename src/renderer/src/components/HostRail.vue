<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useSessions, type HostsSort } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { hostMatches } from '../lib/hostMatch'
import { parseTarget } from '../lib/target'
import { isImeKey } from '../lib/ime'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import type { Host } from '../../../shared/types'
import Icon from './Icon.vue'
import OsIcon from './OsIcon.vue'

// The host rail is the one place hosts live: find, connect, open beside, open the
// files, edit, duplicate, delete. Click connects, Shift+click opens it beside the
// current session, right-click (or ⋯) has the rest.
const emit = defineEmits<{ (e: 'new-host'): void; (e: 'edit-host', h: Host): void }>()
const store = useSessions()
const { t } = useI18n()
const { toast } = useToast()
const { confirm } = useConfirm()

const MODAL_SELECTOR =
  '[aria-modal="true"], .overlay, .pm-overlay, .layer, .key-layer, .fd-overlay, .lock-overlay, .tm-overlay, .rp-overlay, .kp-overlay, .fw-overlay, .dlg-layer, .sv-backdrop'
const query = ref('')
const searchEl = ref<HTMLInputElement>()
const busy = reactive(new Set<string>())

// ---- What is listed ----
// Groups come from ALL hosts (a name group is found among every host, not just the ones the
// filter lets through), then the filter only thins the members out.
const ungroupedLabel = computed(() => t('app.ungrouped'))
const allGroups = computed(() => store.railGroups())
const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return allGroups.value
    .map((g) => ({ ...g, hosts: q ? g.hosts.filter((h) => hostMatches(h, q)) : g.hosts }))
    .filter((g) => g.hosts.length)
})
/** The stored group name of a heading ('' for the ungrouped one). */
const realGroup = (name: string): string => (name === ungroupedLabel.value ? '' : name)
/** A heading only helps when there is more than one group to tell apart. */
const showHeads = computed(() => groups.value.length > 1 || (groups.value[0] && groups.value[0].name !== ungroupedLabel.value))
const visibleOrder = computed(() => groups.value.flatMap((g) => g.hosts))
/** Which group each host shows under now ('' = none), for the menu's "move out of …". */
const groupOf = computed(() => {
  const m = new Map<string, string>()
  for (const g of allGroups.value) for (const h of g.hosts) m.set(h.id, realGroup(g.name))
  return m
})
const customSort = computed(() => store.hostsSort === 'custom')
/** Handles and dragging exist unless the hand-made order is locked. */
const canDrag = computed(() => !(customSort.value && store.sortLocked))
const showGrips = computed(() => customSort.value && !store.sortLocked)

// ---- Selection (Ctrl / ⌘ + click; once something is selected a plain click selects too) ----
const selected = ref(new Set<string>())
const selecting = computed(() => selected.value.size > 0)
function toggleSel(id: string): void {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}
function clearSel(): void {
  if (selected.value.size) selected.value = new Set()
}
// A deleted host leaves the selection with it.
watch(
  () => store.hosts,
  () => {
    const ids = new Set(store.hosts.map((h) => h.id))
    const keep = [...selected.value].filter((id) => ids.has(id))
    if (keep.length !== selected.value.size) selected.value = new Set(keep)
  }
)
function onRowClick(e: MouseEvent, h: Host): void {
  if (e.ctrlKey || e.metaKey || selecting.value) return toggleSel(h.id)
  void open(h, e.shiftKey)
}

// ---- Move to a group (the bar under the list, and the row menu) ----
const move = reactive({ open: false, pos: '', ids: [] as string[], draft: '' })
const moveEl = ref<HTMLElement>()
const moveGroups = computed(() => allGroups.value.filter((g) => g.name !== ungroupedLabel.value).map((g) => ({ name: g.name, count: g.hosts.length })))
function openMoveFor(ids: string[], pos: string): void {
  move.ids = ids
  move.draft = ''
  move.pos = pos
  move.open = true
  void nextTick(() => {
    const el = moveEl.value
    if (!el) return
    // Opened from a row near the bottom (or the right edge): pull it back inside the window.
    const r = el.getBoundingClientRect()
    const top = r.bottom > window.innerHeight - 8 ? Math.max(8, window.innerHeight - r.height - 8) : r.top
    const left = r.right > window.innerWidth - 8 ? Math.max(8, window.innerWidth - r.width - 8) : r.left
    if (top !== r.top || left !== r.left) move.pos = `left:${left}px;top:${top}px`
    el.focus()
  })
}
function openMoveFromBar(e: MouseEvent): void {
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMoveFor([...selected.value], `left:${Math.max(8, b.left - 140)}px;bottom:${window.innerHeight - b.top + 6}px`)
}
function openMoveFromMenu(h: Host): void {
  const ids = selected.value.has(h.id) ? [...selected.value] : [h.id]
  openMoveFor(ids, `left:${menu.x}px;top:${menu.y}px`)
}
async function doMove(group: string): Promise<void> {
  const ids = move.ids
  move.open = false
  if (await store.moveHostsToGroup(ids, group)) clearSel()
}
function submitNewGroup(e: KeyboardEvent): void {
  if (isImeKey(e)) return
  e.preventDefault()
  const name = move.draft.trim()
  if (name) void doMove(name)
}

// ---- Drag and drop: onto a heading = into that group, between rows = that place, a heading
// onto another = the groups' order. Whatever is dropped becomes the hand-made order. ----
const dragIds = ref<string[]>([])
const dragGroup = ref<string | null>(null)
const drop = reactive({ group: null as string | null, before: null as string | null, header: false })
function clearDrop(): void {
  drop.group = null
  drop.before = null
  drop.header = false
}
function onDragEnd(): void {
  dragIds.value = []
  dragGroup.value = null
  clearDrop()
}
function onDragStart(e: DragEvent, h: Host): void {
  if (!canDrag.value) return e.preventDefault()
  const ids = selected.value.has(h.id) ? [...selected.value] : [h.id]
  dragIds.value = ids
  dragGroup.value = null
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', ids.length > 1 ? `${ids.length}` : h.label)
  }
}
function onGroupDragStart(e: DragEvent, name: string): void {
  if (!canDrag.value || name === ungroupedLabel.value) return e.preventDefault()
  dragGroup.value = name
  dragIds.value = []
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', name)
  }
}
function onRowDragOver(e: DragEvent, gName: string, list: Host[], i: number): void {
  if (!dragIds.value.length) return
  e.preventDefault()
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const lower = e.clientY > r.top + r.height / 2
  drop.group = realGroup(gName)
  drop.before = lower ? (list[i + 1]?.id ?? null) : list[i].id
  drop.header = false
}
function onHeaderDragOver(e: DragEvent, gName: string): void {
  if (dragIds.value.length) {
    e.preventDefault()
    drop.group = realGroup(gName)
    drop.before = null
    drop.header = true
  } else if (dragGroup.value && dragGroup.value !== gName) {
    e.preventDefault()
    drop.group = gName
    drop.header = true
  }
}
async function onRowDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  const ids = dragIds.value
  const g = drop.group
  const before = drop.before
  onDragEnd()
  if (ids.length && g !== null && (await store.dropHosts(ids, g, before))) clearSel()
}
async function onHeaderDrop(e: DragEvent, gName: string): Promise<void> {
  e.preventDefault()
  const ids = dragIds.value
  const moving = dragGroup.value
  onDragEnd()
  if (moving) store.reorderGroup(moving, gName === ungroupedLabel.value ? null : gName)
  else if (ids.length && (await store.dropHosts(ids, realGroup(gName), null))) clearSel()
}

// ---- Status: a live session beats the probe ----
const PROBE_EVERY = 180_000
let probeTimer: ReturnType<typeof setInterval> | undefined
function probe(): void {
  if (store.hosts.length && document.visibilityState !== 'hidden') void store.probeReach(undefined, { maxAge: PROBE_EVERY })
}
onMounted(() => {
  probe()
  probeTimer = setInterval(probe, PROBE_EVERY)
  document.addEventListener('visibilitychange', probe)
  window.addEventListener('keydown', onWindowKey)
})
onBeforeUnmount(() => {
  if (probeTimer) clearInterval(probeTimer)
  document.removeEventListener('visibilitychange', probe)
  window.removeEventListener('keydown', onWindowKey)
})
// A host added or edited (address changed) is probed right away; its old answer is dropped.
watch(
  () => store.hosts.map((h) => `${h.id}|${h.host}|${h.port}`).join(','),
  (now, before) => {
    if (!before) return
    const old = new Set(before.split(','))
    const fresh = store.hosts.filter((h) => !old.has(`${h.id}|${h.host}|${h.port}`)).map((h) => h.id)
    if (fresh.length) {
      store.clearReach(fresh)
      void store.probeReach(fresh)
    }
  }
)

function stateOf(h: Host): string {
  // By each pane's own host: a host opened beside another one lives in a split
  // pane of someone else's tab, so the tab's hostId would miss it.
  const panes = store.tabs.flatMap((tab) => tab.panes).filter((p) => p.params.hostId === h.id)
  if (panes.some((p) => p.status === 'connecting')) return 'connecting'
  if (panes.some((p) => p.status === 'connected')) return 'connected'
  if (panes.some((p) => p.status === 'error')) return 'error'
  const reach = store.reach[h.id]
  return reach === 'online' || reach === 'offline' ? reach : ''
}
const currentHostId = computed(() => store.activePane?.params.hostId)
const address = (h: Host): string => `${h.username}@${h.host}${h.port && h.port !== 22 ? ':' + h.port : ''}`

/** The row's tooltip, decided when the pointer arrives (it has to exist before the tooltip layer
 *  reads it, which is why this is a pointer handler and not a template binding): normally the
 *  side-by-side hint; when the address (or else the name) is cut off by the row, that text in
 *  full, since the row cannot show it. */
function setRowTip(e: PointerEvent, h: Host): void {
  const row = e.currentTarget as HTMLElement | null
  if (!row) return
  const cut = (sel: string): boolean => {
    const el = row.querySelector<HTMLElement>(sel)
    return !!el && el.scrollWidth > el.clientWidth
  }
  row.title = cut('.rail-name small') ? address(h) : cut('.rail-label') ? h.label : t('rail.hint')
}

// ---- Quick connect: an address typed in the filter ----
const quickTarget = computed(() => {
  const q = query.value.trim()
  const target = parseTarget(q)
  if (!target) return null
  const explicitUser = !!target.username
  const explicitPort = /:\d+$/.test(q)
  const host = target.host.toLowerCase()
  const saved = store.hosts.find(
    (h) =>
      h.host.toLowerCase() === host &&
      (!explicitPort || (h.port || 22) === target.port) &&
      (!explicitUser || h.username === target.username)
  )
  return { user: target.username ?? 'root', host: target.host, port: target.port, explicitUser, explicitPort, saved }
})
/** Offered when it is clearly an address (user@ or :port typed, or a saved host's
 *  exact address) or when the filter found nothing — "22.04" stays a search. */
const suggest = computed(() => {
  const tg = quickTarget.value
  if (!tg) return null
  return tg.saved || tg.explicitUser || tg.explicitPort || !visibleOrder.value.length ? tg : null
})
function quickGo(): void {
  const tg = suggest.value
  if (!tg) return
  query.value = ''
  if (tg.saved) {
    void open(tg.saved, false)
    return
  }
  store.paletteSeed = `${tg.user}@${tg.host}${tg.port !== 22 ? ':' + tg.port : ''}`
  store.paletteQuick = true
  store.togglePalette(true)
}

// ---- Actions ----
async function open(h: Host, side: boolean): Promise<void> {
  // Only the same host is held back (a double click): a slow connection must not
  // make the rest of the list dead.
  if (busy.has(h.id)) return
  busy.add(h.id)
  try {
    const tab = store.active
    store.setSftpFull(false)
    let asked = false
    if (side && tab && store.activePane?.status === 'connected') {
      const r = await store.splitWithHost(tab.id, h)
      if (r === 'needs-password') asked = true
      else if (r === 'unavailable') toast(t('cmp.unavailable'), 'error')
    } else if ((await store.quickConnect(h)) === 'needs-password') {
      asked = true
    }
    if (asked) {
      // The prompt is up; the keyboard belongs to it, not to the terminal.
      store.askPasswordFor(h)
      return
    }
    store.setPage('terminal')
    store.focusTerminal()
  } finally {
    busy.delete(h.id)
  }
}
async function remove(h: Host): Promise<void> {
  // Deleting a host that others use as their jump host breaks every one of them
  // (connecting through a deleted jump fails closed), so say so first.
  const deps = store.hosts.filter((x) => x.jumpHostId === h.id)
  const msg = deps.length
    ? t('hosts.deleteConfirmJump', { name: h.label, n: deps.length })
    : t('hosts.deleteConfirm', { name: h.label })
  if (await confirm(msg, { title: t('hosts.delete'), confirmText: t('hosts.delete'), danger: true })) await store.removeHost(h.id)
}

function onEnter(e: KeyboardEvent): void {
  // The Enter that commits an IME candidate belongs to the input method.
  if (isImeKey(e)) return
  e.preventDefault()
  if (suggest.value) return quickGo()
  const first = visibleOrder.value[0]
  if (first) {
    void open(first, e.shiftKey)
    query.value = ''
  }
}
// Ctrl/⌘+F, or "/" when not typing somewhere, jumps to the filter.
function onWindowKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && (menu.open || sortOpen.value || move.open)) {
    menu.open = false
    sortOpen.value = false
    move.open = false
    return
  }
  // Esc with a selection and nothing else open: let go of it (a dialog on top keeps its own Esc).
  if (e.key === 'Escape' && selecting.value && !document.querySelector(MODAL_SELECTOR)) {
    clearSel()
    return
  }
  const tgt = e.target as HTMLElement | null
  const typing = tgt?.tagName === 'INPUT' || tgt?.tagName === 'TEXTAREA' || tgt?.isContentEditable
  const find = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f'
  if (find || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
    if (store.paletteOpen || store.lockLocked || store.sheet) return
    // Any dialog or sheet on top (they all use one of these backdrops).
    if (document.querySelector(MODAL_SELECTOR)) return
    if (store.termSidebarHidden) return
    if (e.key !== '/' && tgt?.closest('.xterm')) return
    e.preventDefault()
    searchEl.value?.focus()
    searchEl.value?.select()
  }
}

// ---- Sort ----
const SORTS: HostsSort[] = ['name', 'recent', 'address', 'custom']
const sortLabel = (s: HostsSort): string =>
  ({ recent: t('hosts.sortRecent'), name: t('hosts.sortName'), address: t('hosts.sortAddress'), custom: t('hosts.sortCustom') })[s]
const sortHint = (s: HostsSort): string =>
  ({ recent: '', name: '0 1 2 10', address: '', custom: t('hosts.sortCustomHint') })[s]
const sortOpen = ref(false)

// ---- Row menu ----
const menu = reactive({ open: false, x: 0, y: 0, host: null as Host | null })
const menuEl = ref<HTMLElement>()
async function openMenu(e: MouseEvent, h: Host): Promise<void> {
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const atPointer = e.type === 'contextmenu'
  menu.host = h
  menu.x = atPointer ? e.clientX : b.right
  menu.y = atPointer ? e.clientY : b.bottom + 4
  menu.open = true
  await nextTick()
  const m = menuEl.value?.getBoundingClientRect()
  if (!m) return
  menu.x = Math.max(8, Math.min(menu.x, window.innerWidth - m.width - 8))
  // Focus inside the menu so Esc reaches this window's handler, not the terminal.
  menuEl.value?.focus()
  if (menu.y + m.height > window.innerHeight - 8) menu.y = Math.max(8, (atPointer ? e.clientY : b.top) - m.height - 4)
}
function run(fn: (h: Host) => unknown): void {
  const h = menu.host
  menu.open = false
  if (h) void fn(h)
}
const canSide = computed(() => store.activePane?.status === 'connected' && (store.active?.panes.length ?? 0) < 8)
</script>

<template>
  <div class="rail">
    <div class="rail-title">
      <span class="rt-name">$ hosts<small>{{ store.hosts.length }}</small></span>
      <span class="rt-sort">
        <button class="rt-btn" :class="{ on: sortOpen }" :title="`${t('rail.sort')}: ${sortLabel(store.hostsSort)}`" :aria-label="t('rail.sort')" @click.stop="sortOpen = !sortOpen">
          <Icon name="sort" :ink="11.1" :weight="1.3" />
        </button>
        <template v-if="sortOpen">
          <div class="rail-overlay" @mousedown="sortOpen = false" />
          <div class="rail-pop sort-pop">
            <button v-for="s in SORTS" :key="s" @click="store.setHostsSort(s); sortOpen = false">
              <span class="grow">{{ sortLabel(s) }}</span>
              <small v-if="sortHint(s)" class="hint">{{ sortHint(s) }}</small>
              <Icon v-if="store.hostsSort === s" name="check" :size="14" />
            </button>
          </div>
        </template>
      </span>
      <button
        v-if="customSort"
        class="rt-btn lockbtn"
        :class="{ open: !store.sortLocked }"
        :title="store.sortLocked ? t('rail.lockOn') : t('rail.lockOff')"
        :aria-label="store.sortLocked ? t('rail.lockOn') : t('rail.lockOff')"
        :aria-pressed="store.sortLocked"
        @click="store.setSortLocked(!store.sortLocked)"
      >
        <Icon :name="store.sortLocked ? 'lock' : 'unlock'" :ink="11.1" :weight="1.3" />
      </button>
      <button class="rt-btn" :title="t('app.newConn')" :aria-label="t('app.newConn')" @click="emit('new-host')">
        <Icon name="host-add" :ink="11.1" :weight="1.3" />
      </button>
    </div>
    <input
      ref="searchEl"
      v-model="query"
      class="rail-filter"
      :placeholder="t('rail.filter')"
      :aria-label="t('rail.filter')"
      spellcheck="false"
      autocomplete="off"
      @keydown.enter="onEnter"
      @keydown.esc="query = ''"
    />
    <!-- Unlocked: say so, and where the way back is. -->
    <div v-if="showGrips" class="rail-unlocked">
      <Icon name="unlock" :size="14" />
      <span class="grow">{{ t('rail.unlockedBanner') }}</span>
      <button type="button" @click="store.setSortLocked(true)">{{ t('rail.lock') }}</button>
    </div>
    <div class="rail-list">
      <button v-if="suggest" class="rail-suggest" @click="quickGo">
        <Icon name="terminal" :size="16" />
        <span class="sg-text">
          <b v-if="suggest.saved">{{ suggest.saved.label }}</b>
          <b v-else>{{ t('pal.connectTo', { user: suggest.user, host: suggest.host }) }}</b>
          <small v-if="!suggest.saved">{{ t('pal.portPw', { port: suggest.port }) }}</small>
        </span>
        <kbd>Enter</kbd>
      </button>
      <template v-for="g in groups" :key="g.name">
        <div
          v-if="showHeads"
          class="rail-group"
          :class="{ 'drop-hd': drop.header && drop.group === realGroup(g.name) && !dragGroup, 'drop-group': drop.header && dragGroup && drop.group === g.name }"
          :draggable="canDrag && g.name !== ungroupedLabel"
          @dragstart="onGroupDragStart($event, g.name)"
          @dragend="onDragEnd"
          @dragover="onHeaderDragOver($event, g.name)"
          @dragleave="clearDrop"
          @drop="onHeaderDrop($event, g.name)"
        >
          <span v-if="showGrips && g.name !== ungroupedLabel" class="grip" aria-hidden="true">⋮⋮</span>
          {{ g.name }}<small>{{ g.hosts.length }}</small>
          <span v-if="g.auto" class="auto-tag" :title="t('rail.autoTip')">{{ t('rail.auto') }}</span>
        </div>
        <div
          v-for="(h, i) in g.hosts"
          :key="h.id"
          class="rail-host"
          :class="{
            on: h.id === currentHostId,
            busy: busy.has(h.id),
            sel: selected.has(h.id),
            'drop-before': !drop.header && drop.group === realGroup(g.name) && drop.before === h.id,
            'drop-end': !drop.header && drop.group === realGroup(g.name) && drop.before === null && i === g.hosts.length - 1 && dragIds.length > 0
          }"
          @pointerenter="setRowTip($event, h)"
          @contextmenu.prevent="openMenu($event, h)"
          @dragover="onRowDragOver($event, g.name, g.hosts, i)"
          @drop="onRowDrop"
        >
          <!-- Two sibling buttons (connect, more): no button inside a button. -->
          <button type="button" class="rail-main" :draggable="canDrag" @dragstart="onDragStart($event, h)" @dragend="onDragEnd" @click="onRowClick($event, h)">
            <span v-if="selecting" class="rail-cb" :class="{ on: selected.has(h.id) }" aria-hidden="true"><Icon v-if="selected.has(h.id)" name="check" :size="11" /></span>
            <span v-else-if="showGrips" class="grip" aria-hidden="true">⋮⋮</span>
            <span class="rail-os">
              <OsIcon :os="h.os" :color="h.color" :size="28" />
              <span class="dot" :class="stateOf(h)" :title="stateOf(h)" />
            </span>
            <span class="rail-name">
              <span class="rail-label">{{ h.label }}</span>
              <small>{{ address(h) }}</small>
            </span>
          </button>
          <button type="button" class="rail-more" :class="{ open: menu.open && menu.host?.id === h.id }" :title="t('hosts.more')" :aria-label="`${t('hosts.more')} ${h.label}`" @click.stop="openMenu($event, h)">
            <Icon name="more-horizontal" :size="16" />
          </button>
        </div>
      </template>
      <div v-if="!visibleOrder.length && !suggest" class="rail-none">{{ store.hosts.length ? t('rail.none') : t('start.empty') }}</div>
    </div>

    <!-- A selection: what is picked, and the way to put it in a group. -->
    <div v-if="selecting" class="rail-bar">
      <b>{{ t('rail.selected', { n: selected.size }) }}</b>
      <span class="grow" />
      <button type="button" class="rail-bar-btn primary" @click="openMoveFromBar">{{ t('rail.moveTo') }} ▾</button>
      <button type="button" class="rail-bar-btn" @click="clearSel">{{ t('rail.cancel') }}</button>
    </div>

    <template v-if="move.open">
      <div class="rail-overlay" @mousedown="move.open = false" />
      <div ref="moveEl" class="rail-pop rail-move" role="menu" tabindex="-1" :style="move.pos">
        <div class="mv-title">{{ t('rail.moveTitle', { n: move.ids.length }) }}</div>
        <button v-for="g in moveGroups" :key="g.name" @click="doMove(g.name)"><Icon name="folder" :size="14" /><span class="grow">{{ g.name }}</span><small class="hint">{{ g.count }}</small></button>
        <button @click="doMove('')"><Icon name="close" :size="14" />{{ t('rail.noGroup') }}</button>
        <div class="sep" />
        <input v-model="move.draft" class="mv-input" :placeholder="t('rail.newGroupPh')" spellcheck="false" maxlength="40" @keydown.enter="submitNewGroup" />
      </div>
    </template>

    <template v-if="menu.open">
      <div class="rail-overlay" @mousedown="menu.open = false" @contextmenu.prevent="menu.open = false" />
      <div ref="menuEl" class="rail-pop rail-menu" role="menu" tabindex="-1" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
        <button @click="run((h) => open(h, false))"><Icon name="play" :size="13" />{{ t('hosts.connect') }}</button>
        <button :disabled="!canSide" @click="run((h) => open(h, true))"><Icon name="layout" :size="14" />{{ t('rail.side') }}</button>
        <button :disabled="!!store.sftpConnecting" @click="run((h) => store.openSftpFor(h))"><Icon name="folder" :size="14" />{{ t('rail.files') }}</button>
        <div class="sep" />
        <button @click="run(openMoveFromMenu)"><Icon name="folder" :size="14" />{{ t('rail.moveTo') }}</button>
        <button v-if="menu.host && groupOf.get(menu.host.id)" @click="run((h) => store.moveHostsToGroup([h.id], ''))"><Icon name="close" :size="14" />{{ t('rail.removeFrom', { name: groupOf.get(menu.host.id) ?? '' }) }}</button>
        <button @click="run((h) => emit('edit-host', h))"><Icon name="edit" :size="14" />{{ t('hosts.edit') }}</button>
        <button @click="run((h) => store.duplicateHost(h))"><Icon name="copy" :size="14" />{{ t('hosts.duplicate') }}</button>
        <div class="sep" />
        <button class="danger" @click="run(remove)"><Icon name="trash" :size="14" />{{ t('hosts.delete') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  font-family: var(--font-chrome);
}
/* The rail's top band is the tab bar's height, with the same hairline under it: the title and
   its icons sit on the tab bar's centre line, and the line runs on across the window. */
.rail-title {
  display: flex;
  align-items: center;
  flex: none;
  gap: 2px;
  height: var(--band-top);
  margin: 0 -10px;
  padding: 0 8px 0 18px;
  box-shadow: inset 0 -1px 0 var(--chrome-line);
}
/* macOS: the traffic lights are OS-drawn at a fixed size and a fixed spot, so
   this row counter-scales with the app zoom (constant 40 pt on screen) and the
   title starts after the lights at a constant 82 pt. Keep the zoom in step with
   TabBar's `barStyle`; the two rows share one height and one hairline. */
.sidebar.mac .rail-title {
  zoom: calc(1 / var(--zf, 1));
  padding-left: 82px;
}
.rt-name {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.rt-name small {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-faint);
}
.rt-sort {
  position: relative;
}
.rt-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--text);
}
.rt-btn:hover,
.rt-btn.on {
  color: var(--text);
  background: var(--hover);
}
.rail-filter {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  font: inherit;
  font-size: 13.5px;
  color: var(--text);
  background: var(--bg-elev-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  caret-color: var(--cursor);
  user-select: text;
}
.rail-filter:focus {
  border-color: var(--text);
}
.rail-filter::placeholder {
  color: var(--text-faint);
}
.rail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  /* The scrollbar sits in the rail's own side padding, so rows and the filter /
     new-host button share one right edge. Its look comes from the global
     ::-webkit-scrollbar (scrollbar-width would replace it with the OS's). */
  margin-right: -8px;
}
.rail-list::-webkit-scrollbar {
  width: 8px;
}
.rail-suggest {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin-bottom: 4px;
  text-align: left;
  color: var(--text);
  background: var(--bg-elev-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.sg-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.sg-text b {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sg-text small {
  font-size: 11.5px;
  color: var(--text-faint);
}
.rail-suggest kbd {
  font: inherit;
  font-size: 11px;
  color: var(--text-faint);
}
.rail-group {
  display: flex;
  gap: 6px;
  padding: 10px 10px 3px;
  font-size: 12px;
  color: var(--text-faint);
}
.rail-group small {
  font-size: 11px;
}
.rail-host {
  display: flex;
  align-items: center;
  padding-right: 4px;
  border-radius: 8px;
  color: var(--text-dim);
  transition: background 0.15s, color 0.15s;
}
.rail-host:hover {
  background: var(--hover);
  color: var(--text);
}
.rail-host.on {
  background: var(--selected);
  color: var(--text);
}
.rail-host.busy {
  opacity: 0.6;
}
.rail-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 6px 4px 6px 8px;
  font: inherit;
  color: inherit;
  text-align: left;
  border-radius: 8px;
  cursor: pointer;
}
.rail-main:active {
  transform: scale(0.98);
}
.rail-main:focus-visible,
.rail-more:focus-visible {
  outline: 2px solid var(--cursor);
  outline-offset: -2px;
}
.rail-os {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
}
/* The state dot rides on the OS icon's corner; a ring of the rail's own colour
   keeps it readable on top of the icon. Unknown = no dot at all. */
.dot {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 9px;
  height: 9px;
  box-sizing: border-box;
  border-radius: 50%;
  background: var(--text-faint);
  border: 2px solid var(--bg-elev);
  opacity: 0;
}
.dot.online {
  background: var(--ok);
  opacity: 0.55;
}
.dot.offline {
  background: var(--text-faint);
  opacity: 0.7;
}
.dot.connected {
  background: var(--ok);
  opacity: 1;
}
.dot.connecting {
  background: var(--warn);
  opacity: 1;
}
.dot.error {
  background: var(--danger);
  opacity: 1;
}
.rail-name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}
.rail-label {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-name small {
  font-size: 12px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-more {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--text-faint);
  opacity: 0;
  border-radius: var(--radius-sm);
}
.rail-host:hover .rail-more,
.rail-more:focus-visible,
.rail-more.open {
  opacity: 1;
}
.rail-more:hover,
.rail-more.open {
  color: var(--text);
  background: var(--hover);
}
.rail-none {
  padding: 12px;
  font-size: 13px;
  color: var(--text-faint);
}
.rail-overlay {
  position: fixed;
  inset: 0;
  z-index: 95;
}
.rail-pop {
  position: fixed;
  z-index: 96;
  min-width: 170px;
  padding: 5px;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-menu);
  box-shadow: var(--shadow);
  animation: pop-in 0.14s var(--ease);
}
.sort-pop {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
}
.rail-pop button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
  color: var(--text-dim);
  text-align: left;
  border-radius: var(--r-item);
}
.rail-pop button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.rail-pop button:disabled {
  opacity: 0.4;
  cursor: default;
}
.rail-pop button.danger {
  color: var(--danger);
}
.rail-pop .grow {
  flex: 1;
}
.rail-pop .sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--chrome-line);
}
.rail-pop .hint,
.hint {
  font-size: 11.5px;
  color: var(--text-faint);
}

/* ---- Groups: the "auto" mark, drag handles, drop targets, selection ---- */
.auto-tag {
  margin-left: 2px;
  padding: 0 6px;
  font-size: 11px;
  color: var(--text-faint);
  background: var(--bg-elev-2);
  border-radius: 4px;
}
.grip {
  flex: none;
  width: 12px;
  font-size: 12px;
  letter-spacing: -2px;
  color: var(--text-faint);
  opacity: 0.6;
  cursor: grab;
}
.rail-group[draggable='true'] {
  cursor: grab;
}
.rt-btn.lockbtn {
  color: var(--cursor);
}
.rt-btn.lockbtn.open {
  color: var(--warn);
}
/* The rail's scrollbar shows while the pointer is over the list or it is being scrolled, not all the time. */
.rail-list::-webkit-scrollbar-thumb {
  background: transparent;
}
.rail-list:hover::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  background-clip: padding-box;
}
.rail-unlocked {
  display: flex;
  align-items: center;
  flex: none;
  gap: 8px;
  padding: 0 4px 0 10px;
  height: 30px;
  font-size: 12px;
  color: var(--warn);
  border: 1px dashed color-mix(in srgb, var(--warn) 50%, transparent);
  border-radius: var(--radius-sm);
}
.rail-unlocked .grow {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-unlocked button {
  height: 22px;
  padding: 0 8px;
  font: inherit;
  color: var(--console);
  background: var(--warn);
  border-radius: 4px;
}
.rail-group.drop-hd {
  color: var(--cursor);
  background: color-mix(in srgb, var(--cursor) 10%, transparent);
  outline: 1.5px dashed var(--cursor);
  outline-offset: -1.5px;
  border-radius: 6px;
}
.rail-group.drop-group {
  box-shadow: 0 -2px 0 var(--cursor);
}
.rail-host {
  position: relative;
}
.rail-host.drop-before::before,
.rail-host.drop-end::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--cursor);
  pointer-events: none;
}
.rail-host.drop-before::before {
  top: -1px;
}
.rail-host.drop-end::after {
  bottom: -1px;
}
.rail-host.sel {
  background: color-mix(in srgb, var(--cursor) 12%, transparent);
  color: var(--text);
}
.rail-cb {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  color: var(--console);
  border: 1.5px solid var(--text-faint);
  border-radius: 4px;
}
.rail-cb.on {
  background: var(--cursor);
  border-color: var(--cursor);
}
.rail-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 8px 10px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-menu);
  font-size: 13px;
}
.rail-bar b {
  color: var(--cursor);
  font-weight: 600;
}
.rail-bar .grow {
  flex: 1;
}
.rail-bar-btn {
  height: 28px;
  padding: 0 10px;
  font: inherit;
  font-size: 12.5px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.rail-bar-btn:hover {
  border-color: var(--text-faint);
}
.rail-bar-btn.primary {
  color: var(--console);
  background: var(--text);
  border-color: var(--text);
}
.rail-move {
  min-width: 230px;
  max-height: 60vh;
  overflow-y: auto;
}
.mv-title {
  padding: 6px 10px 4px;
  font-size: 12px;
  color: var(--text-faint);
}
.mv-input {
  width: calc(100% - 8px);
  height: 32px;
  margin: 2px 4px 4px;
  padding: 0 10px;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  background: var(--bg-elev-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  caret-color: var(--cursor);
  user-select: text;
}
.mv-input:focus {
  border-color: var(--text);
  outline: none;
}

/* ================= Compact two-line rows ================= */
/* The name is what you look for: bright. The address under it is the quiet line. */
.rail-label {
  font-size: 13.5px;
  color: var(--text);
}
.rail-name {
  line-height: 1.3;
}
.rail-name small {
  font-size: 11.5px;
}
.rail-main {
  gap: 10px;
  padding: 4px 4px 4px 8px;
}
.rail-host {
  border-radius: 6px;
}
/* The system marks keep their own colour (the tile's tint and ring come from OsIcon). Only the
   shape is tightened: a smaller radius, and the mark fills most of the tile so the systems can
   be told apart. */
.rail-os :deep(.os-tile) {
  border-radius: 6px;
}
.rail-os :deep(.os-tile svg) {
  width: 68%;
  height: 68%;
}
/* Green means one thing: a session is open. A host that merely answers shows no dot;
   one that does not answer shows a hollow ring. */
.dot.online {
  opacity: 0;
}
.dot.offline {
  background: var(--bg-elev);
  border: 1.5px solid var(--text-faint);
  opacity: 1;
}
/* The search field: a hairline frame, no fill, like the other fields. */
.rail-filter {
  height: 30px;
  padding: 0 10px;
  background: transparent;
  border-color: var(--border-strong);
}
.rail-filter:hover {
  border-color: var(--text-faint);
}
.rail-filter:focus {
  border-color: var(--text);
}
/* Locked is the quiet, normal state; only "unlocked" asks for attention. */
.rt-btn.lockbtn {
  color: var(--text);
}
.rt-btn.lockbtn.open {
  color: var(--warn);
}
/* The last visible row fades out instead of being cut by the foot. */
.rail-list {
  padding-bottom: 14px;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent);
}
</style>
