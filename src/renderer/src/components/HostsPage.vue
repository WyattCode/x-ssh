<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, nextTick } from 'vue'
import { useSessions, type HostsSort } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { useConfirm } from '../composables/confirm'
import { formatAgo } from '../lib/transferFormat'
import { parseTarget } from '../lib/target'
import { isImeKey } from '../lib/ime'
import type { Host } from '../../../shared/types'
import Icon from './Icon.vue'
import OsIcon from './OsIcon.vue'

const emit = defineEmits<{ (e: 'new-host'): void; (e: 'edit-host', h: Host): void }>()
const store = useSessions()
const { t } = useI18n()
const { confirm } = useConfirm()

// ---- Status: a live session beats the probe ----
type HostState = 'connected' | 'online' | 'offline' | 'unknown'
const connectedIds = computed(() => {
  const saved = new Set(store.hosts.map((h) => h.id))
  const ids = new Set<string>()
  for (const tab of store.tabs) {
    // Only saved hosts: a host deleted while connected mustn't push 已连接 past the total.
    for (const p of tab.panes) if (p.status === 'connected' && p.params.hostId && saved.has(p.params.hostId)) ids.add(p.params.hostId)
  }
  return ids
})
function stateOf(h: Host): HostState {
  if (connectedIds.value.has(h.id)) return 'connected'
  return store.reach[h.id] ?? 'unknown'
}
const stateLabel = (s: HostState): string =>
  ({ connected: t('hosts.connected'), online: t('hosts.online'), offline: t('hosts.offline'), unknown: t('hosts.unknown') })[s]

// Probe when the page opens (or, at startup, as soon as the host list has
// loaded — the page is up before it), then every 3 minutes while the window is
// visible, and on coming back to a window that missed a round.
// ICMP first (main/reachability.ts), so most hosts never see a TCP hit.
const PROBE_EVERY = 180_000
let probeTimer: ReturnType<typeof setInterval> | null = null
/** A full round unless one ran within `maxAge` (the store remembers across visits). */
function probe(maxAge: number): void {
  if (!store.hosts.length || document.visibilityState === 'hidden') return
  void store.probeReach(undefined, { maxAge })
}
function onVisible(): void {
  if (document.visibilityState === 'visible') probe(PROBE_EVERY)
}
watch(
  () => store.hosts.length > 0,
  (has) => {
    if (has) probe(60_000)
  },
  { immediate: true }
)
onMounted(() => {
  probeTimer = setInterval(() => probe(PROBE_EVERY - 5_000), PROBE_EVERY)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  if (probeTimer) clearInterval(probeTimer)
  document.removeEventListener('visibilitychange', onVisible)
})
// A host added or edited (address changed) gets probed right away.
watch(
  () => store.hosts.map((h) => `${h.id}|${h.host}|${h.port}`).join(','),
  (now, before) => {
    if (!before) return
    const old = new Set(before.split(','))
    const fresh = store.hosts.filter((h) => !old.has(`${h.id}|${h.host}|${h.port}`)).map((h) => h.id)
    if (fresh.length) void store.probeReach(fresh)
  }
)

// ---- Stats ----
const groupNames = computed(() => {
  const set = new Set<string>()
  for (const h of store.hosts) if (h.group?.trim()) set.add(h.group.trim())
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
})
const stats = computed(() => {
  let online = 0
  let offline = 0
  for (const h of store.hosts) {
    const s = stateOf(h)
    if (s === 'online' || s === 'connected') online++
    else if (s === 'offline') offline++
  }
  return { total: store.hosts.length, online, offline, connected: connectedIds.value.size }
})

// ---- Filter / group tabs / sort ----
const query = ref('')
const UNGROUPED = '\u0000'
const activeGroup = ref<string>('')
const hasUngrouped = computed(() => store.hosts.some((h) => !h.group?.trim()))
const groupTabs = computed(() => {
  const tabs = groupNames.value.map((g) => ({ id: g, label: g, n: store.hosts.filter((h) => h.group?.trim() === g).length }))
  if (tabs.length && hasUngrouped.value) {
    tabs.push({ id: UNGROUPED, label: t('app.ungrouped'), n: store.hosts.filter((h) => !h.group?.trim()).length })
  }
  return tabs
})
// A group that disappeared (renamed / last host removed) falls back to 全部.
watch(groupTabs, (tabs) => {
  if (activeGroup.value && !tabs.some((g) => g.id === activeGroup.value)) activeGroup.value = ''
})

function matches(h: Host, q: string): boolean {
  if (!q) return true
  const hay = [h.label, h.host, h.username, `${h.username}@${h.host}`, h.group ?? '', ...(h.tags ?? []), h.os?.pretty ?? '']
    .join('\n')
    .toLowerCase()
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  const g = activeGroup.value
  const list = store.hosts.filter((h) => {
    if (g === UNGROUPED ? !!h.group?.trim() : g && h.group?.trim() !== g) return false
    return matches(h, q)
  })
  const sort = store.hostsSort
  return list.sort((a, b) =>
    sort === 'name'
      ? collator.compare(a.label, b.label)
      : sort === 'address'
        ? collator.compare(a.host, b.host) || a.port - b.port
        : (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  )
})
const SORTS: HostsSort[] = ['recent', 'name', 'address']
const sortLabel = (s: HostsSort): string =>
  ({ recent: t('hosts.sortRecent'), name: t('hosts.sortName'), address: t('hosts.sortAddress') })[s]
const sortOpen = ref(false)

function address(h: Host): string {
  return h.port && h.port !== 22 ? `${h.host}:${h.port}` : h.host
}

// ---- Quick connect, from the toolbar search field ----
// Typing user@host[:port] offers "connect to …" under the field (macOS HIG:
// search sits at the trailing side of the toolbar, with suggestions); Enter
// takes it. A saved host with that address connects with its saved
// credentials, anything else opens the palette on its password step. With no
// address typed, Enter connects the only host left by the filter.
const quickTarget = computed(() => {
  const q = query.value.trim()
  const target = parseTarget(q)
  if (!target) return null
  const explicitUser = !!target.username
  const explicitPort = /:\d+$/.test(q)
  const host = target.host.toLowerCase()
  // A saved host at that address (the port / user only count when typed).
  const saved = store.hosts.find(
    (h) =>
      h.host.toLowerCase() === host &&
      (!explicitPort || (h.port || 22) === target.port) &&
      (!explicitUser || h.username === target.username)
  )
  return { user: target.username ?? 'root', host: target.host, port: target.port, explicitUser, explicitPort, saved }
})
const searchFocused = ref(false)
/** The suggestion is for an address, not a search: offered when it's clearly
 *  one (user@ or :port typed, or a saved host's exact address) or when the
 *  filter found nothing — "22.04" or a partial IP stays a search. */
const showSuggest = computed(() => {
  const tg = quickTarget.value
  if (!tg || !searchFocused.value) return false
  return !!tg.saved || tg.explicitUser || tg.explicitPort || !visible.value.length
})
function quickGo(): void {
  const tg = quickTarget.value
  if (!tg) return
  query.value = ''
  searchEl.value?.blur()
  if (tg.saved) {
    void connect(tg.saved)
    return
  }
  store.paletteSeed = `${tg.user}@${tg.host}${tg.port !== 22 ? ':' + tg.port : ''}`
  store.paletteQuick = true
  store.togglePalette(true)
}
/** Enter: the suggested address when one is offered, else the only host the
 *  filter left. */
function onSearchEnter(e: KeyboardEvent): void {
  // The Enter that commits an IME candidate belongs to the input method — taking
  // it here would connect to a host on the keystroke that only picked a word out
  // of the candidate list. `.prevent` in the template runs *before* this check
  // and would also stop the candidate from ever being committed (the search box
  // simply stops responding to Enter while composing), so the keydown is bound
  // plainly and cancelled here.
  if (isImeKey(e)) return
  e.preventDefault()
  if (showSuggest.value) quickGo()
  else if (visible.value.length === 1) {
    const only = visible.value[0]
    query.value = ''
    void connect(only)
  }
}

// ---- Actions ----
async function connect(h: Host): Promise<void> {
  if ((await store.quickConnect(h)) === 'needs-password') store.askPasswordFor(h)
}
function openSftp(h: Host): Promise<void> {
  return store.openSftpFor(h)
}
const removing = ref(false)
async function remove(h: Host): Promise<void> {
  if (removing.value) return
  const ok = await confirm(t('hosts.deleteConfirm', { name: h.label }), {
    title: t('hosts.delete'),
    confirmText: t('hosts.delete'),
    danger: true
  })
  if (!ok) return
  removing.value = true
  try {
    await store.removeHost(h.id)
  } finally {
    removing.value = false
  }
}

// ---- Card menu ----
const menu = reactive({ open: false, x: 0, y: 0, host: null as Host | null })
const menuEl = ref<HTMLElement>()
let menuOpener: HTMLElement | null = null
watch(
  () => menu.open,
  (open) => {
    if (!open && menuOpener?.isConnected) menuOpener.focus({ preventScroll: true })
    if (!open) menuOpener = null
  }
)
async function openMenu(e: MouseEvent, h: Host): Promise<void> {
  // Keyboard: Enter / Space on ⋯ (detail 0) or the Menu key (a contextmenu
  // with no pointer). Only then does focus go into the menu and back after —
  // after a mouse open, restoring focus would pin the card's hover state.
  const fromKeyboard = e.type === 'contextmenu' ? (e as PointerEvent).pointerType === '' : e.detail === 0
  menuOpener = fromKeyboard ? (e.currentTarget as HTMLElement) : null
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
  // Right-click on a card opens at the pointer; ⋯ opens under the button.
  const atPointer = e.type === 'contextmenu' && !fromKeyboard
  menu.host = h
  menu.x = atPointer ? e.clientX : b.right
  menu.y = atPointer ? e.clientY : b.bottom + 6
  menu.open = true
  await nextTick()
  // Keep it on screen: right-align to the button, flip up near the bottom.
  const m = menuEl.value?.getBoundingClientRect()
  if (!m) return
  if (atPointer) {
    menu.x = Math.max(8, Math.min(e.clientX, window.innerWidth - m.width - 8))
    if (menu.y + m.height > window.innerHeight - 8) menu.y = Math.max(8, e.clientY - m.height)
  } else {
    menu.x = Math.max(8, b.right - m.width)
    if (menu.y + m.height > window.innerHeight - 8) menu.y = Math.max(8, b.top - m.height - 6)
  }
  // Opened from the keyboard: arrows / Tab start inside the menu.
  if (fromKeyboard) menuEl.value?.querySelector('button')?.focus()
}
function onMenuKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = [...(menuEl.value?.querySelectorAll('button') ?? [])]
  const i = items.indexOf(document.activeElement as HTMLButtonElement)
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
}
function run(fn: (h: Host) => unknown): void {
  const h = menu.host
  menu.open = false
  if (h) void fn(h)
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && (menu.open || sortOpen.value)) {
    menu.open = false
    sortOpen.value = false
    return
  }
  // Ctrl/⌘+F, or "/" when not already typing somewhere, jumps to search.
  const tgt = e.target as HTMLElement | null
  const typing = tgt?.tagName === 'INPUT' || tgt?.tagName === 'TEXTAREA' || tgt?.isContentEditable
  const find = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f'
  if (find || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
    if (store.paletteOpen || store.lockLocked) return
    if (document.querySelector('[aria-modal="true"], .overlay')) return
    e.preventDefault()
    searchEl.value?.focus()
    searchEl.value?.select()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const searchEl = ref<HTMLInputElement>()
defineExpose({ focusSearch: () => searchEl.value?.focus() })
</script>

<template>
  <div class="hosts-page">
    <div class="wrap">
      <!-- The brand lives in the sidebar; here the same title row as every other page. -->
      <header class="page-head">
        <h1>{{ t('nav.hosts') }}</h1>
        <div class="page-actions">
          <label class="search">
            <Icon name="search" :size="16" />
            <input
              ref="searchEl"
              v-model="query"
              :placeholder="t('hosts.search')"
              spellcheck="false"
              @keydown.esc="query = ''"
              @keydown.enter="onSearchEnter"
              @focus="searchFocused = true"
              @blur="searchFocused = false"
            />
            <button v-if="query" class="clear" :title="t('hosts.clear')" @click="query = ''"><Icon name="close" :size="12" /></button>
            <!-- Suggestion: an address was typed — connect to it. -->
            <button v-if="showSuggest && quickTarget" class="suggest" @mousedown.prevent @click="quickGo">
              <Icon name="terminal" :size="15" />
              <span v-if="quickTarget.saved" class="sg-text">
                <b>{{ quickTarget.saved.label }}</b>
                <small>{{ quickTarget.saved.username }}@{{ address(quickTarget.saved) }}</small>
              </span>
              <span v-else class="sg-text">
                <b>{{ t('pal.connectTo', { user: quickTarget.user, host: quickTarget.host }) }}</b>
                <small>{{ t('pal.portPw', { port: quickTarget.port }) }}</small>
              </span>
              <kbd>Enter</kbd>
            </button>
          </label>
          <div class="tools">
            <div class="sort">
              <button class="sort-btn" :class="{ on: sortOpen }" @click.stop="sortOpen = !sortOpen">
                {{ sortLabel(store.hostsSort) }}<Icon name="chevron-down" :size="14" />
              </button>
              <div v-if="sortOpen" class="pop-overlay" @mousedown="sortOpen = false" />
              <div v-if="sortOpen" class="pop sort-pop">
                <button v-for="s in SORTS" :key="s" @click="store.setHostsSort(s); sortOpen = false">
                  <span class="grow">{{ sortLabel(s) }}</span>
                  <Icon v-if="store.hostsSort === s" name="check" :size="14" class="tick" />
                </button>
              </div>
            </div>
            <div class="views">
              <button :class="{ on: store.hostsView === 'grid' }" :title="t('hosts.viewGrid')" @click="store.setHostsView('grid')">
                <Icon name="grid" :size="16" />
              </button>
              <button :class="{ on: store.hostsView === 'list' }" :title="t('hosts.viewList')" @click="store.setHostsView('list')">
                <Icon name="list" :size="16" />
              </button>
            </div>
          </div>
          <button class="add" :title="t('app.newConn')" @click="emit('new-host')"><Icon name="plus" :size="18" /></button>
        </div>
      </header>

      <section class="stats">
        <div class="stat">
          <span class="st-icon"><Icon name="server" :size="18" /></span>
          <span class="st-text"><b>{{ stats.total }}</b><small>{{ t('hosts.total') }}</small></span>
        </div>
        <div class="stat">
          <span class="st-icon"><span class="dot big online" /></span>
          <span class="st-text"><b>{{ stats.online }}</b><small>{{ t('hosts.online') }}</small></span>
        </div>
        <div class="stat">
          <span class="st-icon"><span class="dot big offline" /></span>
          <span class="st-text"><b>{{ stats.offline }}</b><small>{{ t('hosts.offline') }}</small></span>
        </div>
        <div class="stat">
          <span class="st-icon"><Icon name="terminal" :size="18" /></span>
          <span class="st-text"><b>{{ stats.connected }}</b><small>{{ t('hosts.connected') }}</small></span>
        </div>
      </section>

      <!-- Group tabs only when there are groups (a lone 全部 says nothing). -->
      <section v-if="groupTabs.length" class="list-head">
        <nav class="gtabs">
          <button :class="{ on: activeGroup === '' }" @click="activeGroup = ''">
            {{ t('hosts.all') }}<span class="n">{{ store.hosts.length }}</span>
          </button>
          <button v-for="g in groupTabs" :key="g.id" :class="{ on: activeGroup === g.id }" @click="activeGroup = g.id">
            {{ g.label }}<span class="n">{{ g.n }}</span>
          </button>
        </nav>
      </section>

      <div v-if="store.hosts.length && !visible.length && !showSuggest" class="no-match">
        <span class="nm-icon"><Icon name="search" :size="22" /></span>
        <p>{{ query.trim() ? t('hosts.noMatchFor', { q: query.trim() }) : t('hosts.noMatch') }}</p>
        <button v-if="query" class="btn" @click="query = ''">{{ t('hosts.clear') }}</button>
      </div>

      <!-- Grid -->
      <section v-if="store.hostsView === 'grid'" class="grid">
        <div
          v-for="h in visible"
          :key="h.id"
          class="hcard"
          :class="{ busy: store.sftpConnecting === h.id }"
          :style="{ '--host': h.color || 'var(--accent)' }"
          role="button"
          tabindex="0"
          @click="connect(h)"
          @keydown.enter.self="connect(h)"
          @keydown.space.self.prevent="connect(h)"
          @contextmenu.prevent="openMenu($event, h)"
        >
          <OsIcon :os="h.os" :color="h.color" :size="40" />
          <div class="hc-main">
            <div class="hc-title">
              <span class="dot" :class="stateOf(h)" :title="stateLabel(stateOf(h))" />
              <span class="name">{{ h.label }}</span>
            </div>
            <div class="hc-addr" :title="`${h.username}@${address(h)}`">{{ address(h) }}</div>
            <div v-if="h.tags?.length" class="tags">
              <span v-for="tg in h.tags.slice(0, 3)" :key="tg" class="tag">{{ tg }}</span>
              <span v-if="h.tags.length > 3" class="tag more">+{{ h.tags.length - 3 }}</span>
            </div>
          </div>
          <!-- Wide cards (two-column windows): when it was last used. The OS
               name stays out — the icon already says it (tooltip has the full name). -->
          <span v-if="h.lastUsedAt" class="hc-meta">{{ formatAgo(h.lastUsedAt, t) }}</span>
          <div class="actions">
            <button
              class="more"
              :class="{ open: menu.open && menu.host?.id === h.id }"
              :title="t('hosts.more')"
              @click.stop="openMenu($event, h)"
            >
              <Icon name="more-horizontal" :size="16" />
            </button>
            <button class="play" :class="stateOf(h)" :title="t('hosts.connect')" @click.stop="connect(h)"><Icon name="play" :size="13" /></button>
          </div>
        </div>
        <button v-if="!store.hosts.length" class="hcard add-card" @click="emit('new-host')">
          <Icon name="plus" :size="18" />
          <span>{{ t('app.newConn') }}</span>
        </button>
      </section>

      <!-- List -->
      <section v-else class="rows">
        <div
          v-for="h in visible"
          :key="h.id"
          class="hrow"
          :class="{ busy: store.sftpConnecting === h.id }"
          :style="{ '--host': h.color || 'var(--accent)' }"
          role="button"
          tabindex="0"
          @click="connect(h)"
          @keydown.enter.self="connect(h)"
          @keydown.space.self.prevent="connect(h)"
          @contextmenu.prevent="openMenu($event, h)"
        >
          <OsIcon :os="h.os" :color="h.color" :size="30" />
          <span class="dot" :class="stateOf(h)" :title="stateLabel(stateOf(h))" />
          <span class="r-name">{{ h.label }}</span>
          <span class="r-addr">{{ h.username }}@{{ address(h) }}</span>
          <span class="r-tags">
            <span v-for="tg in (h.tags ?? []).slice(0, 3)" :key="tg" class="tag">{{ tg }}</span>
          </span>
          <span class="r-group">{{ h.group?.trim() || '' }}</span>
          <span class="r-when">{{ h.lastUsedAt ? formatAgo(h.lastUsedAt, t) : '' }}</span>
          <button
            class="more"
            :class="{ open: menu.open && menu.host?.id === h.id }"
            :title="t('hosts.more')"
            @click.stop="openMenu($event, h)"
          >
            <Icon name="more-horizontal" :size="16" />
          </button>
          <button class="play" :class="stateOf(h)" :title="t('hosts.connect')" @click.stop="connect(h)"><Icon name="play" :size="12" /></button>
        </div>
        <button v-if="!store.hosts.length" class="hrow add-row" @click="emit('new-host')">
          <Icon name="plus" :size="16" />
          <span>{{ t('app.newConn') }}</span>
        </button>
      </section>
    </div>

    <div v-if="menu.open" class="pop-overlay" @mousedown="menu.open = false" @contextmenu.prevent="menu.open = false" />
    <div v-if="menu.open" ref="menuEl" class="pop card-menu" role="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @keydown="onMenuKey">
      <button @click="run(connect)"><Icon name="play" :size="13" />{{ t('hosts.connect') }}</button>
      <button :disabled="!!store.sftpConnecting" @click="run(openSftp)"><Icon name="folder" :size="14" />{{ t('hosts.openSftp') }}</button>
      <button @click="run((h) => emit('edit-host', h))"><Icon name="edit" :size="14" />{{ t('hosts.edit') }}</button>
      <button @click="run((h) => store.duplicateHost(h))"><Icon name="copy" :size="14" />{{ t('hosts.duplicate') }}</button>
      <div class="sep" />
      <button class="danger" @click="run(remove)"><Icon name="trash" :size="14" />{{ t('hosts.delete') }}</button>
    </div>
  </div>
</template>

<style scoped>
/* Spacing runs on a 4 / 8 px grid; --hover / --selected / --ease come from
   styles/global.css. */
.hosts-page {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--bg);
}
/* The column is a size container: stats and host cards pick their column
   count from the space they really have (the sidebar is 64–360px wide). */
.wrap {
  position: relative;
  container-type: inline-size;
  /* A size container can't take its width from its content: fill the page. */
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 24px 36px 48px;
}
/* Quick-connect suggestion under the search field (same look as the menus). */
.suggest {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 96;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  text-align: left;
  color: var(--accent);
  background-color: color-mix(in srgb, var(--bg-elev) 94%, transparent);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-menu);
  box-shadow: var(--shadow);
  animation: pop-in 0.14s var(--ease);
  cursor: pointer;
}
.suggest:hover {
  background-color: color-mix(in srgb, var(--accent) 8%, var(--bg-elev));
}
.sg-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sg-text b {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sg-text small {
  font-size: 11.5px;
  color: var(--text-faint);
}
.suggest kbd {
  flex: none;
  padding: 2px 8px;
  font-family: var(--font-ui);
  font-size: 11px;
  color: var(--text-dim);
  background: var(--hover);
  border: 1px solid var(--border);
  border-radius: 6px;
}

/* Title row (global .page-head): search + add on the right. */
.page-head {
  margin-bottom: 16px;
}
.page-actions {
  gap: 10px;
}
/* Toolbar search field: a capsule (macOS 27 large control), filled; focus is a
   soft accent ring rather than a hard border swap. */
.search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 1 400px;
  min-width: 0;
  height: 40px;
  padding: 0 16px;
  color: var(--text-faint);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  cursor: text;
  transition: border-color 0.16s var(--ease), box-shadow 0.16s var(--ease), background 0.16s var(--ease);
}
.search:hover {
  border-color: var(--border-strong);
}
.search:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: var(--bg-elev);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
}
.search:focus-within > :deep(svg) {
  color: var(--accent);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 13.5px;
}
.search input::placeholder {
  color: var(--text-faint);
}
.search .clear {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: -4px;
  border-radius: var(--r-pill);
  color: var(--bg);
  background: var(--text-dim);
  transition: background 0.16s var(--ease);
}
.search .clear:hover {
  background: var(--text);
}
/* Prominent action = accent circle, same height as the field; a hairline
   highlight instead of a coloured glow. */
.add {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--r-pill);
  color: #fff;
  background: var(--accent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: filter 0.16s var(--ease), transform 0.12s var(--ease);
}
.add:hover {
  filter: brightness(1.1);
}
.add:active {
  transform: scale(0.94);
}

/* ---- Stats ---- */
/* Same columns, gap, padding and icon size as the host cards below, so the
   stat icons and numbers line up with the OS icons and host names. */
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.stat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
}
.st-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--r-tile);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-elev-2));
}
.st-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.st-text b {
  font-size: 20px;
  font-weight: 650;
  line-height: 1.1;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.st-text small {
  font-size: 12px;
  color: var(--text-faint);
  white-space: nowrap;
}

/* ---- Status dot ----
   Quiet by design: 6px, no halo. Not probed yet (or behind a jump / proxy):
   a hairline ring — present, but the lightest of the three. */
.dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
}
.dot.online {
  background: var(--ok, #3fb950);
}
.dot.connected {
  background: var(--accent);
}
.dot.offline {
  background: var(--text-faint);
}
.dot.unknown {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--text-faint);
  opacity: 0.8;
}
.dot.big {
  width: 11px;
  height: 11px;
}
.st-icon .dot.online {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok, #3fb950) 16%, transparent);
}

/* ---- List head ---- */
.list-head {
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 0 0 16px;
}
.gtabs {
  display: flex;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.gtabs button {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--r-pill);
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.gtabs button:hover {
  background: var(--hover);
  color: var(--text);
}
.gtabs button.on {
  color: var(--text);
  background: var(--selected);
}
.gtabs .n {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: var(--r-pill);
  font-size: 11px;
  text-align: center;
  color: var(--text-faint);
  background: var(--hover);
  font-variant-numeric: tabular-nums;
}
.gtabs button.on .n {
  color: var(--text-dim);
  background: var(--selected);
}
.tools {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
}
.sort {
  position: relative;
}
.sort-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px 0 16px;
  font-size: 13px;
  white-space: nowrap;
  color: var(--text-dim);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  transition: border-color 0.16s var(--ease), color 0.16s var(--ease), background 0.16s var(--ease);
}
.sort-btn :deep(svg) {
  transition: transform 0.16s var(--ease);
}
.sort-btn:hover,
.sort-btn.on {
  color: var(--text);
  border-color: var(--border-strong);
}
.sort-btn.on :deep(svg) {
  transform: rotate(180deg);
}
.sort-pop {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  min-width: 150px;
}
/* Segmented control: capsule track, capsule thumb. */
.views {
  flex: none;
  display: flex;
  height: 40px;
  padding: 3px;
  gap: 2px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
}
.views button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  border-radius: var(--r-pill);
  color: var(--text-faint);
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.views button:hover {
  color: var(--text-dim);
  background: var(--hover);
}
.views button.on {
  color: var(--text);
  background: var(--selected);
}
.no-match {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: 56px 0;
  font-size: 13px;
  color: var(--text-dim);
}
.no-match p {
  margin: 0;
}
.nm-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  color: var(--text-faint);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
}
.hcard.busy,
.hrow.busy {
  pointer-events: none;
  opacity: 0.6;
}

/* ---- Grid cards ---- */
/* Four columns on a typical window (three / two / one as the column narrows
   — a card needs ~260px for a long name next to ⋯ + ▶); rows equal height. */
.grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 12px;
}
.hcard {
  position: relative;
  container: card / inline-size;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  text-align: left;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  cursor: pointer;
  transition:
    border-color 0.18s var(--ease),
    transform 0.18s var(--ease),
    box-shadow 0.18s var(--ease),
    background 0.18s var(--ease);
}
/* Hover: a lift and a faint tint of the host colour — not a glow. */
.hcard:hover {
  border-color: color-mix(in srgb, var(--host) 22%, var(--border-strong));
  background: color-mix(in srgb, var(--host) 3%, var(--bg-elev));
  transform: translateY(-1px);
  box-shadow: 0 10px 24px -18px rgba(0, 0, 0, 0.55);
}
.hcard:active {
  transform: translateY(0) scale(0.99);
  box-shadow: none;
}
.hcard:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
  outline-offset: 2px;
}
.hc-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hc-meta {
  display: none;
  flex: none;
  font-size: 11.5px;
  color: var(--text-faint);
  white-space: nowrap;
}
@container card (min-width: 300px) {
  .hc-meta {
    display: block;
  }
}
.hc-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hc-addr {
  font-size: 12px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* One line of tags; the rest of the space goes to the name. */
.tags {
  display: flex;
  gap: 4px;
  overflow: hidden;
  margin-top: 1px;
}
.tag {
  flex: none;
  padding: 0 7px;
  font-size: 11px;
  line-height: 17px;
  color: var(--text-dim);
  background: color-mix(in srgb, var(--text) 6%, transparent);
  border-radius: var(--r-pill);
  white-space: nowrap;
}
.tag.more {
  color: var(--text-faint);
}
/* ⋯ and ▶ sit together, vertically centred on the right. ⋯ only shows on
   hover / keyboard focus (and while its menu is open), so a card at rest
   carries a single action. */
.actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}
/* A narrow ⋯ so the name keeps its room on a four-column card. */
.more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 30px;
  border-radius: var(--r-pill);
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 0.16s var(--ease), background 0.16s var(--ease), color 0.16s var(--ease);
}
/* On a card ⋯ floats in the top-right corner instead of taking a column:
   the name gets that room, and ▶ stays the one resting action. */
.hcard .more {
  /* ⋯ appears on hover just left of ▶, centred on the same line. It floats
     over the card instead of reserving a column: the name makes room only
     while it shows, and on wide cards it takes the last-used time's place. */
  position: absolute;
  top: 50%;
  right: 46px;
  width: 28px;
  height: 28px;
  transform: translateY(-50%);
}
/* Where ⋯ lands: over the last-used time on wide cards (the time steps
   aside), else at the end of the name's space (the name makes room). */
@container card (max-width: 299.98px) {
  .hcard:hover .hc-main,
  .hcard:has(:focus-visible) .hc-main,
  .hcard:has(.more.open) .hc-main {
    padding-right: 30px;
  }
}
@container card (min-width: 300px) {
  .hcard:hover .hc-meta,
  .hcard:has(:focus-visible) .hc-meta,
  .hcard:has(.more.open) .hc-meta {
    visibility: hidden;
  }
  .hcard:not(:has(.hc-meta)):hover .hc-main,
  .hcard:not(:has(.hc-meta)):has(:focus-visible) .hc-main,
  .hcard:not(:has(.hc-meta)):has(.more.open) .hc-main {
    padding-right: 30px;
  }
}
.hcard:hover .more,
.hrow:hover .more,
.hcard:has(:focus-visible) .more,
.hrow:has(:focus-visible) .more,
.hcard:focus-visible .more,
.hrow:focus-visible .more,
.more.open {
  opacity: 1;
}
.more:hover,
.more.open {
  background: var(--selected);
  color: var(--text);
}
.play {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding-left: 2px;
  border-radius: var(--r-pill);
  color: var(--text-dim);
  border: 1px solid var(--border-strong);
  transition:
    color 0.16s var(--ease),
    border-color 0.16s var(--ease),
    background 0.16s var(--ease),
    transform 0.12s var(--ease);
}
.play.online,
.play.connected {
  color: var(--text);
  border-color: color-mix(in srgb, var(--text) 30%, transparent);
}
/* Card hover: tinted, not a solid fill; the button itself goes one step deeper. */
.hcard:hover .play,
.hrow:hover .play {
  color: var(--host);
  border-color: color-mix(in srgb, var(--host) 45%, transparent);
  background: color-mix(in srgb, var(--host) 12%, transparent);
}
.hcard .play:hover,
.hrow .play:hover {
  background: color-mix(in srgb, var(--host) 22%, transparent);
}
.play:active {
  transform: scale(0.92);
}
.add-card {
  justify-content: center;
  gap: 10px;
  color: var(--text-dim);
  background: transparent;
  border: 1.5px dashed var(--border-strong);
  font-size: 13.5px;
}
.add-card:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--text) 30%, transparent);
  background: color-mix(in srgb, var(--text) 3%, transparent);
  box-shadow: none;
}

/* ---- List rows ---- */
.rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hrow {
  display: grid;
  grid-template-columns: 30px 8px minmax(120px, 1.2fr) minmax(160px, 1.4fr) minmax(0, 1.4fr) minmax(0, 0.8fr) 84px 24px 30px;
  align-items: center;
  gap: 12px;
  padding: 7px 12px;
  text-align: left;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-menu);
  cursor: pointer;
  transition: border-color 0.16s var(--ease), background 0.16s var(--ease), transform 0.12s var(--ease);
}
.hrow:hover {
  border-color: color-mix(in srgb, var(--host) 22%, var(--border-strong));
  background: color-mix(in srgb, var(--host) 3%, var(--bg-elev));
}
.hrow:active {
  transform: scale(0.995);
}
.hrow:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
  outline-offset: 2px;
}
/* Concentric with the 12px row: 12 − 8px inset ≈ 4, so the fallback. */
.hrow :deep(.os-tile) {
  border-radius: 8px;
}
.hrow .play {
  width: 30px;
  height: 30px;
}
.r-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.r-addr {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.r-tags {
  display: flex;
  gap: 5px;
  overflow: hidden;
}
.r-group,
.r-when {
  font-size: 12px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.r-when {
  text-align: right;
}
.add-row {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  color: var(--text-dim);
  background: transparent;
  border: 1.5px dashed var(--border-strong);
  font-size: 13px;
}
.add-row:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--text) 30%, transparent);
  background: color-mix(in srgb, var(--text) 3%, transparent);
}

/* ---- Popovers (sort, card menu) ---- */
.pop-overlay {
  position: fixed;
  inset: 0;
  z-index: 95;
}
.pop {
  position: fixed;
  z-index: 96;
  padding: 5px;
  background-color: color-mix(in srgb, var(--bg-elev) 94%, transparent);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-menu);
  box-shadow: var(--shadow);
  animation: pop-in 0.14s var(--ease);
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
}
.sort-pop {
  position: absolute;
  transform-origin: top right;
}
.pop button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--r-item);
  font-size: 13px;
  color: var(--text);
  text-align: left;
  white-space: nowrap;
  transition: background 0.12s var(--ease);
}
.pop button:hover {
  background: var(--accent-soft);
}
.pop .grow {
  flex: 1;
}
.pop .tick {
  color: var(--accent);
}
.card-menu {
  min-width: 168px;
}
.card-menu button :deep(svg) {
  flex: none;
  width: 16px;
  color: var(--text-dim);
}
.card-menu .danger,
.card-menu .danger :deep(svg) {
  color: var(--danger, #f0616d);
}
.card-menu .danger:hover {
  background: color-mix(in srgb, var(--danger, #f0616d) 12%, transparent);
}
.pop .sep {
  height: 1px;
  margin: 5px 6px;
  background: var(--border);
}

@container (max-width: 1075px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@container (max-width: 1075px) {
  /* Four stats over fewer card columns can't share edges: one strip instead
     (no dividers inside — the spacing alone separates them). */
  .stats {
    gap: 0;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }
  .stat {
    background: none;
    border: none;
    border-radius: 0;
  }
}
@container (max-width: 803px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 531px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* The narrowest window: the title row's tools take their own line, the stats
   go 2 × 2, list rows drop the address column. */
@container (max-width: 560px) {
  .page-head {
    flex-wrap: wrap;
    row-gap: 12px;
  }
  /* (qualified: the plain .page-actions / .hrow rules come later in the file) */
  .page-head .page-actions {
    flex-basis: 100%;
  }
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .rows .hrow {
    grid-template-columns: 30px 8px minmax(0, 1fr) 24px 30px;
  }
  .r-addr {
    display: none;
  }
}
@container (max-width: 900px) {
  .hrow {
    grid-template-columns: 30px 8px minmax(100px, 1fr) minmax(140px, 1.2fr) 24px 30px;
  }
  .r-tags,
  .r-group,
  .r-when {
    display: none;
  }
}
.page-actions {
  flex: 1;
  justify-content: flex-end;
  min-width: 0;
}
</style>
