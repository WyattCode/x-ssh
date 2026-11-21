<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'
const trapEl = ref<HTMLElement>()
useFocusTrap(trapEl, () => store.paletteOpen)
import { useSessions } from '../stores/sessions'
import { fuzzyScore, fuzzyMatch } from '../lib/fuzzy'
import { toPlain } from '../lib/plain'
import { paletteHostScore } from '../lib/paletteHostScore'
import { parseTarget } from '../lib/target'
import { isImeKey } from '../lib/ime'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import Icon from './Icon.vue'
import OsIcon from './OsIcon.vue'
import type { ConnectParams, Host, Snippet } from '../../../shared/types'

const store = useSessions()
const { t } = useI18n()
const { toast } = useToast()
const { confirm } = useConfirm()
const emit = defineEmits<{
  (e: 'new-host'): void
  (e: 'edit-host', h: Host): void
}>()

/** hostId of the currently-focused pane, so host-scoped snippets filter in. */
const activeHostId = computed(() => store.activePane?.params.hostId ?? null)

type Item =
  | { kind: 'quick'; title: string; sub: string; params: ConnectParams }
  | { kind: 'host'; title: string; sub: string; tail: string; host: Host; known: boolean; live: boolean }
  | { kind: 'snippet'; title: string; sub: string; snippet: Snippet }
  | { kind: 'action'; title: string; sub: string; run: () => void; icon: string }
  | { kind: 'snapshot'; title: string; sub: string; id: string; icon: string }

const query = ref('')
const selected = ref(0)
// Highlighting must use the same trimmed query as scoring, or a trailing space
// makes the marks disagree with what actually matched.
const qTrim = computed(() => query.value.trim())
const inputEl = ref<HTMLInputElement>()
const listEl = ref<HTMLDivElement>()

// Keyboard navigation must keep the selected row visible: with enough hosts
// the list scrolls (46vh cap) and Enter would otherwise activate an item the
// user can't see.
watch(selected, () => {
  nextTick(() => {
    listEl.value?.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' })
  })
})

// Inline password prompt state.
const pending = ref<{ params: ConnectParams; title: string } | null>(null)
const password = ref('')
const remember = ref(true)
/** One connect per prompt: a second Enter (or a slow save) must not open two. */
const submitting = ref(false)
const pwEl = ref<HTMLInputElement>()

// Inline broadcast-command prompt state.
const broadcastOpen = ref(false)
const broadcastCmd = ref('')
const broadcastEl = ref<HTMLInputElement>()

/** Saved hosts that already have a connected pane, so the list can say so —
 *  otherwise an open host looks identical to a closed one and gets reopened. */
const liveHostIds = computed(() => {
  const ids = new Set<string>()
  for (const tab of store.tabs) {
    for (const p of tab.panes) {
      if (p.status === 'connected' && p.params.hostId) ids.add(p.params.hostId)
    }
  }
  return ids
})

/** Port 22 is the default and says nothing; only a non-default port is shown. */
const hostAddr = (h: Host): string =>
  `${h.username}@${h.host}${h.port === 22 ? '' : `:${h.port}`}`

function newHost(): void {
  store.togglePalette(false)
  emit('new-host')
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 60)

// Splits text into highlight/non-highlight segments for the query's fuzzy
// match, so the palette can <mark> the matched characters.
function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  if (!query) return [{ text, hit: false }]
  const idx = fuzzyMatch(query, text)
  if (!idx.length) return [{ text, hit: false }]
  const set = new Set(idx)
  const segs: { text: string; hit: boolean }[] = []
  let pos = 0
  for (let i = 0; i < text.length; i++) {
    if (!set.has(i)) continue
    if (i > pos) segs.push({ text: text.slice(pos, i), hit: false })
    let j = i
    while (j + 1 < text.length && set.has(j + 1)) j++
    segs.push({ text: text.slice(i, j + 1), hit: true })
    pos = j + 1
    i = j
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), hit: false })
  return segs
}

const sections = computed<{ id: string; title: string; items: Item[] }[]>(() => {
  const q = query.value.trim()
  const out: { id: string; title: string; items: Item[] }[] = []
  const add = (id: string, title: string, items: Item[]): void => {
    if (items.length) out.push({ id, title, items })
  }

  const parsed = parseTarget(q)
  if (parsed) {
    const username = parsed.username ?? 'root'
    add('quick', t('pal.quick'), [
      {
        kind: 'quick',
        title: t('pal.connectTo', { user: username, host: parsed.host }),
        sub: t('pal.portPw', { port: parsed.port }),
        params: { host: parsed.host, port: parsed.port, username, auth: 'password' }
      }
    ])
  }

  const scored = store.hosts
    .map((h) => ({
      h,
      score: q ? paletteHostScore(q, h) : (h.lastUsedAt ?? 0) / 1e13
    }))
    .filter((r) => r.score > (q ? -1 : -Infinity))
    .sort((a, b) => b.score - a.score)
  add(
    'hosts',
    // With no query the order is most-recently-used first; say so, or it
    // reads as random.
    // (Only when something has actually been used — a fresh list is in saved
    // order, and calling that "recent" would be wrong.)
    !q && store.hosts.some((h) => h.lastUsedAt) ? t('pal.hostsRecent') : t('pal.hosts'),
    scored.map(({ h }) => ({
      kind: 'host' as const,
      title: h.label,
      sub: hostAddr(h),
      // The group is a word, not an address: kept out of the monospace part.
      tail: h.group ?? '',
      host: h,
      known: store.hostKeyKnown(h.host, h.port),
      live: liveHostIds.value.has(h.id)
    }))
  )

  const snips = store.snippets.filter((s) => {
    // A snippet scoped to a specific host only shows for that connection.
    if (s.hostId && s.hostId !== activeHostId.value) return false
    return !q || fuzzyScore(q, s.title) > -1 || fuzzyScore(q, s.text) > -1
  })
  // Group snippets by their (optional) group, preserving user order; a folder
  // with no group falls under the plain "snippets" heading.
  const sniGroups: { label: string; items: Item[] }[] = []
  for (const s of snips) {
    const label = s.group?.trim() || ''
    let grp = sniGroups.find((x) => x.label === label)
    if (!grp) {
      grp = { label, items: [] }
      sniGroups.push(grp)
    }
    grp.items.push({
      kind: 'snippet' as const,
      title: s.title,
      sub: oneLine(s.text),
      snippet: s
    })
  }
  for (const grp of sniGroups) {
    add(`snippets:${grp.label || ''}`, grp.label || t('pal.snippets'), grp.items)
  }

  const actions: Item[] = []
  const matchesAction = (label: string): boolean => !q || fuzzyScore(q, label) > -1
  if (matchesAction('新建主机 new saved host')) {
    actions.push({
      kind: 'action',
      title: t('pal.newHost'),
      sub: t('pal.newHostDesc'),
      icon: 'plus',
      run: () => emit('new-host')
    })
  }
  if (matchesAction('导入 openssh ssh config')) {
    actions.push({
      kind: 'action',
      title: t('pal.importSsh'),
      sub: t('pal.importSshDesc'),
      icon: 'download',
      run: () => void importSshConfig()
    })
  }
  if (matchesAction('历史历史 search history output')) {
    actions.push({
      kind: 'action',
      title: t('pal.history'),
      sub: t('pal.historyDesc'),
      icon: 'search',
      run: () => store.toggleHistory(true)
    })
  }
  if (matchesAction('tmux 会话 session 管理 接入 attach')) {
    actions.push({
      kind: 'action',
      title: t('pal.tmux'),
      sub: t('pal.tmuxDesc'),
      icon: 'terminal',
      run: () => store.toggleTmux(true)
    })
  }
  if (matchesAction('广播 broadcast command 所有 send all')) {
    actions.push({
      kind: 'action',
      title: t('pal.broadcast'),
      sub: t('pal.broadcastDesc'),
      icon: 'send',
      run: openBroadcast
    })
  }
  if (matchesAction('发布公钥 密钥 key 上传 authorized 主机')) {
    actions.push({
      kind: 'action',
      title: t('pal.publishKey'),
      sub: t('pal.publishKeyDesc'),
      icon: 'keyboard',
      run: () => store.togglePublish(true)
    })
  }
  if (matchesAction('会话回放 replay 日志 log 记录')) {
    actions.push({
      kind: 'action',
      title: t('pal.replay'),
      sub: t('pal.replayDesc'),
      icon: 'file',
      run: () => store.toggleReplay(true)
    })
  }
  // The terminal page's own switches, so everything the prototype put in the
  // palette is here too: fold the host rail, files, forwards, settings.
  if (store.tabs.length && matchesAction('收起 展开 主机栏 侧栏 hide show hosts rail sidebar focus')) {
    actions.push({
      kind: 'action',
      title: t('pal.fold'),
      sub: t('pal.foldDesc'),
      icon: 'sidebar',
      run: () => {
        store.setPage('terminal')
        store.setTermSidebarHidden(!store.termSidebarHidden)
      }
    })
  }
  if (store.activePane?.status === 'connected' && matchesAction('文件 sftp files 上传 下载 upload')) {
    actions.push({
      kind: 'action',
      title: t('pal.files'),
      sub: t('pal.filesDesc'),
      icon: 'folder',
      run: () => {
        store.setPage('terminal')
        store.toggleSftp()
      }
    })
  }
  if (matchesAction('端口转发 forward port tunnel 隧道')) {
    actions.push({
      kind: 'action',
      title: t('nav.forwards'),
      sub: t('pal.forwardsDesc'),
      icon: 'forward',
      run: () => store.setPage('forwards')
    })
  }
  if (matchesAction('设置 settings preferences 偏好')) {
    actions.push({
      kind: 'action',
      title: t('nav.settings'),
      sub: t('pal.settingsDesc'),
      icon: 'settings',
      run: () => store.toggleSettings()
    })
  }
  add('actions', t('pal.actions'), actions)

  // Named session snapshots: capture & restore the whole tab layout.
  // Always shown — the save action is the entry point, so the section is not
  // conditional on there being anything saved yet.
  {
    const snaps: Item[] = []
    snaps.push({
      kind: 'action',
      title: t('pal.snapSave'),
      sub: t('pal.snapSaveDesc'),
      icon: 'book',
      run: () => {
        if (!store.tabs.length) {
          toast(t('pal.snapEmpty'), 'error')
          return
        }
        void store.saveSnapshot(`${t('pal.snapDefault')} ${new Date().toLocaleTimeString()}`)
      }
    })
    for (const s of store.snapshots) {
      snaps.push({
        kind: 'snapshot',
        title: s.name,
        sub: new Date(s.savedAt).toLocaleString(),
        id: s.id,
        icon: 'zap'
      })
      snaps.push({
        kind: 'action',
        title: t('pal.snapDelete', { name: s.name }),
        sub: t('pal.snapDeleteDesc'),
        icon: 'trash',
        run: () => void store.deleteSnapshot(s.id)
      })
    }
    add('snapshots', t('pal.snapshots'), snaps)
  }
  return out
})

/** Flat list of actionable items (headers stripped) for keyboard navigation. */
const items = computed<Item[]>(() => sections.value.flatMap((s) => s.items))

/** What Enter does to the highlighted row: connect for a host, run otherwise. */
const enterHint = computed(() => {
  const k = items.value[selected.value]?.kind
  return !k || k === 'host' || k === 'quick' ? t('pal.connect') : t('pal.run')
})

/** Running index of each section's first item in the flat list. */
const sectionStarts = computed<number[]>(() => {
  let acc = 0
  return sections.value.map((s) => {
    const st = acc
    acc += s.items.length
    return st
  })
})

watch(items, () => {
  if (selected.value >= items.value.length) selected.value = 0
})

// A new query reorders the list; keep the highlight on the top match instead
// of leaving it on whatever row happened to be selected before.
watch(query, () => {
  selected.value = 0
})

/** Imports hosts from ~/.ssh/config, then refreshes the list + security cache. */
async function importSshConfig(): Promise<void> {
  const res = await window.api.hosts.importSshConfig()
  if (!res.ok) {
    toast(
      res.error === 'ssh-config-missing' ? t('set.sec.importSshMissing') : (res.error ?? t('set.sec.importFail')),
      'error'
    )
    return
  }
  store.togglePalette(false)
  await store.loadHosts()
  await store.loadKnownHosts()
  if (res.count > 0) {
    toast(t('set.sec.importSshOk', { n: res.count }), 'success')
  } else if (!res.parsed) {
    toast(t('set.sec.importSshNoHost'), 'info')
  } else {
    toast(t('set.sec.importSshAllKnown', { n: res.parsed }), 'info')
  }
}
watch(
  () => store.paletteOpen,
  (open) => {
    if (open) {
      // A launch target seeds the query, and the first item is the match for it,
      // so the default selection (0) already points at "connect to…".
      query.value = store.paletteSeed ?? ''
      store.paletteSeed = null
      selected.value = 0
      pending.value = null
      password.value = ''
      remember.value = true
      const quick = store.paletteQuick
      const pwHost = store.hosts.find((h) => h.id === store.palettePasswordFor)
      store.paletteQuick = false
      store.palettePasswordFor = null
      nextTick(() => {
        // From 连接: a typed address, or a saved host with no password saved —
        // go straight to its password.
        const first = sections.value[0]?.items[0]
        if (pwHost) activateHost(pwHost)
        else if (quick && first?.kind === 'quick') activate(first)
        else inputEl.value?.focus()
      })
    }
  }
)

function connect(params: ConnectParams, title: string): void {
  store.togglePalette(false)
  void store.openConnection(params, title)
}

function activateHost(h: Host): void {
  // Password auth with no stored secret → prompt inline instead of failing.
  if (h.auth === 'password' && !h.hasSavedPassword) {
    pending.value = {
      params: {
        host: h.host,
        port: h.port,
        username: h.username,
        auth: 'password',
        hostId: h.id
      },
      title: h.label
    }
    nextTick(() => pwEl.value?.focus())
    return
  }
  // Otherwise connect with hostId so the main process resolves any stored
  // secret. Key/agent auth needs no secret from the renderer.
  connect(
    {
      host: h.host,
      port: h.port,
      username: h.username,
      auth: h.auth,
      keyPath: h.keyPath,
      hostId: h.id
    },
    h.label
  )
}

/** Side by side needs a live session to put the host beside. */
const canSide = computed(() => store.activePane?.status === 'connected' && (store.active?.panes.length ?? 0) < 8)

async function openBeside(h: Host): Promise<void> {
  const tab = store.active
  if (!tab) return
  store.togglePalette(false)
  const r = await store.splitWithHost(tab.id, h)
  if (r === 'needs-password') toast(t('cmp.needsPassword', { name: h.label }), 'error')
  else if (r === 'unavailable') toast(t('cmp.unavailable'), 'error')
}

function activate(item: Item): void {
  if (item.kind === 'quick') {
    // Quick connect always prompts for a password.
    pending.value = { params: item.params, title: item.params.host }
    nextTick(() => pwEl.value?.focus())
  } else if (item.kind === 'host') {
    activateHost(item.host)
  } else if (item.kind === 'snippet') {
    store.togglePalette(false)
    void store.sendSnippet(item.snippet)
  } else if (item.kind === 'snapshot') {
    store.togglePalette(false)
    void store.openSnapshot(item.id)
  } else {
    store.togglePalette(false)
    item.run()
  }
}

async function deleteSnap(item: { id: string; title: string }): Promise<void> {
  const ok = await confirm(t('pal.snapDeleteConfirm', { name: item.title }))
  if (!ok) return
  await store.deleteSnapshot(item.id)
}

async function submitPassword(): Promise<void> {
  // Enter can arrive twice while the first attempt is still saving/writing —
  // without this each press started its own connection.
  if (!pending.value || submitting.value) return
  submitting.value = true
  try {
    const { params, title } = pending.value
    // Persist the password to the host (encrypted) so we don't prompt next time.
    if (remember.value && params.hostId && password.value) {
      const h = store.hosts.find((x) => x.id === params.hostId)
      if (h) {
        try {
          store.hosts = await window.api.hosts.save(toPlain(h), password.value)
        } catch {
          // Remembering it is a convenience; connect anyway and say why it
          // wasn't saved instead of dropping the connect on the floor.
          toast(t('ed.saveFail'), 'error')
        }
      }
    }
    connect({ ...params, password: password.value }, title)
  } finally {
    submitting.value = false
  }
}

function openBroadcast(): void {
  broadcastCmd.value = ''
  broadcastOpen.value = true
  nextTick(() => broadcastEl.value?.focus())
}
function submitBroadcast(): void {
  const cmd = broadcastCmd.value
  broadcastOpen.value = false
  store.togglePalette(false)
  const sent = store.broadcastCommand(cmd)
  toast(sent ? t('pal.broadcastSent', { n: sent }) : t('pal.broadcastNone'), sent ? 'success' : 'error')
}
/** Enter in the broadcast box sends the command to every live session — a
 *  real, hard-to-undo action, so it must not fire on the Enter that only
 *  commits an IME candidate. Bound here rather than with `.prevent` in the
 *  template, which would run first and swallow the candidate. */
function onBroadcastEnter(e: KeyboardEvent): void {
  if (isImeKey(e)) return
  e.preventDefault()
  submitBroadcast()
}

/** Clicking the dim overlay goes back one step while a prompt is open (the
 *  same thing Esc does) instead of throwing the whole flow away — a mis-click
 *  next to the palette shouldn't lose a typed password or command. */
function onOverlayDismiss(): void {
  if (pending.value) {
    pending.value = null
    password.value = ''
    nextTick(() => inputEl.value?.focus())
    return
  }
  if (broadcastOpen.value) {
    broadcastOpen.value = false
    nextTick(() => inputEl.value?.focus())
    return
  }
  store.togglePalette(false)
}

function onKey(e: KeyboardEvent): void {
  // While an IME is composing, Enter/arrows/Esc are the candidate list's, not
  // ours — searching a Chinese host label would otherwise connect on the Enter
  // that just picks the word.
  if (isImeKey(e)) return
  if (broadcastOpen.value) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitBroadcast()
    } else if (e.key === 'Escape') {
      broadcastOpen.value = false
      nextTick(() => inputEl.value?.focus())
    }
    return
  }
  if (pending.value) {
    // Handle Enter at the palette level (not just on the password <input>): the
    // prompt also has a "remember password" checkbox, and if focus lands there
    // (or anywhere but the field) Enter must still submit and connect.
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault()
      void submitPassword()
    } else if (e.key === 'Escape') {
      pending.value = null
      nextTick(() => inputEl.value?.focus())
    }
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selected.value = (selected.value + 1) % Math.max(items.value.length, 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selected.value =
      (selected.value - 1 + items.value.length) % Math.max(items.value.length, 1)
  } else if (e.key === 'Enter') {
    // Enter on the footer's own button is that button's: without this, tabbing
    // to 新建主机 and pressing Enter connected to the highlighted host instead.
    if ((e.target as HTMLElement | null)?.closest('.hint-new')) return
    e.preventDefault()
    const item = items.value[selected.value]
    if (item) {
      // Shift+Enter on a host puts it beside the current session.
      if (e.shiftKey && item.kind === 'host' && canSide.value) void openBeside(item.host)
      else activate(item)
    }
  } else if (e.key === 'Escape') {
    store.togglePalette(false)
  }
}
</script>

<template>
  <div v-if="store.paletteOpen" class="overlay" @mousedown.self="onOverlayDismiss">
    <div ref="trapEl" role="dialog" aria-modal="true" :aria-label="t('pal.dialog')" tabindex="-1" class="palette" @keydown="onKey">
      <!-- Broadcast command prompt -->
      <template v-if="broadcastOpen">
        <div class="pw-head">
          <span class="pw-title">{{ t('pal.broadcast').replace(/…$/, '') }}</span>
        </div>
        <input
          ref="broadcastEl"
          v-model="broadcastCmd"
          class="search"
          :placeholder="t('pal.broadcastPlaceholder')"
          spellcheck="false"
          autocomplete="off"
          @keydown.enter.stop="onBroadcastEnter"
        />
        <div class="hint">
          <span><span class="kbd">Enter</span> {{ t('pal.broadcastSend') }}</span>
          <span><span class="kbd">Esc</span> {{ t('pal.back') }}</span>
        </div>
      </template>
      <!-- Password prompt -->
      <template v-else-if="pending">
        <div class="pw-head">
          <span class="pw-title">{{ t('pal.pwTitle', { user: pending.params.username, host: pending.params.host }) }}</span>
        </div>
        <input
          ref="pwEl"
          v-model="password"
          type="password"
          class="search"
          autocomplete="off"
          :placeholder="t('pal.pwPlaceholder')"
        />
        <label v-if="pending.params.hostId" class="pw-remember">
          <input v-model="remember" type="checkbox" />
          <span>{{ t('pal.rememberPw') }}</span>
        </label>
        <div class="hint">
          <span><span class="kbd">Enter</span> {{ t('pal.connect') }}</span>
          <span><span class="kbd">Esc</span> {{ t('pal.back') }}</span>
        </div>
      </template>

      <!-- Search -->
      <template v-else>
        <input
          ref="inputEl"
          v-model="query"
          class="search"
          :placeholder="t('pal.placeholder')"
          spellcheck="false"
          autocomplete="off"
        />
        <div ref="listEl" class="list">
          <template v-for="(sec, si) in sections" :key="si">
            <div v-if="sec.items.length" class="group">{{ sec.title }}</div>
            <button
              v-for="(item, ii) in sec.items"
              :key="`${si}-${ii}`"
              class="row"
              :class="{ sel: sectionStarts[si] + ii === selected }"
              @click="activate(item)"
              @mousemove="selected = sectionStarts[si] + ii"
            >
              <!-- Hosts look as they do on 连接: their OS tile. -->
              <OsIcon v-if="item.kind === 'host'" :os="item.host.os" :color="item.host.color" :size="30" />
              <span v-else class="icon" :class="item.kind">
                <Icon
                  :name="
                    item.kind === 'quick' ? 'arrow-right' : item.kind === 'snippet' ? 'zap' : item.icon
                  "
                  :size="15"
                />
              </span>
              <span class="text">
                <span class="title">
                  <template v-for="(seg, sk) in highlight(item.title, qTrim)" :key="'t' + sk">
                    <mark v-if="seg.hit" class="match">{{ seg.text }}</mark>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </span>
                <span class="sub" :class="{ mono: item.kind === 'host' || item.kind === 'quick' || item.kind === 'snippet' }">
                  <template v-for="(seg, sk) in highlight(item.sub, qTrim)" :key="'s' + sk">
                    <mark v-if="seg.hit" class="match">{{ seg.text }}</mark>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                  <span v-if="item.kind === 'host' && item.tail" class="sub-tail"> · {{ item.tail }}</span>
                </span>
              </span>
              <span v-if="item.kind === 'host' && item.live" class="live">
                <span class="live-dot" />{{ t('pal.connected') }}
              </span>
              <span
                v-if="item.kind === 'host'"
                class="edit"
                :title="t('pal.edit')"
                @click.stop="emit('edit-host', item.host); store.togglePalette(false)"
              ><Icon name="edit" :size="14" /></span>
              <span
                v-if="item.kind === 'snapshot'"
                class="edit"
                :title="t('pal.snapDelete')"
                @click.stop="void deleteSnap(item)"
              ><Icon name="trash" :size="14" /></span>
            </button>
          </template>
          <div v-if="!items.length" class="empty">
            <span class="empty-icon"><Icon name="search" :size="18" /></span>
            {{ t('pal.empty') }}
          </div>
        </div>
        <div class="hint">
          <span><span class="kbd">↑</span><span class="kbd">↓</span> {{ t('pal.nav') }}</span>
          <span><span class="kbd">Enter</span> {{ enterHint }}</span>
          <span v-if="canSide"><span class="kbd">Shift</span><span class="kbd">Enter</span> {{ t('pal.side') }}</span>
          <span><span class="kbd">Esc</span> {{ t('pal.close') }}</span>
          <button class="hint-new" @click="newHost">
            <Icon name="plus" :ink="13" :weight="1.6" />{{ t('pal.newHostShort') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  z-index: 100;
  animation: fade-in 0.12s ease;
}
.palette {
  width: min(620px, 92vw);
  /* Frosted glass, but heavily blurred and nearly opaque: a clear panel let the
     page behind (spinners, status text) read through the host list. */
  background-color: color-mix(in srgb, var(--bg-elev) 88%, transparent);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  font-family: var(--font-chrome);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  overflow: hidden;
  transform-origin: 50% 0;
  animation: pop-in 0.46s cubic-bezier(0.3, 1.35, 0.5, 1);
}
.search {
  width: 100%;
  padding: 16px 18px;
  font-size: 15px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  outline: none;
}
/* Focus is marked on the divider line, not with a box: a ring here was
   clipped by the panel's rounded top corners. */
.search:focus {
  border-bottom-color: var(--accent);
}
.search::placeholder {
  color: var(--text-faint);
}
.list {
  max-height: 46vh;
  overflow-y: auto;
  padding: 6px;
}
.group {
  padding: 8px 12px 4px;
  font-size: 11.5px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.key-badge {
  margin-left: 7px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  vertical-align: 1px;
}
.key-badge.known {
  color: var(--ok);
  background: rgba(81, 207, 102, 0.12);
}
.key-badge.unknown {
  color: var(--warn);
  background: rgba(255, 212, 59, 0.12);
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  text-align: left;
}
.row.sel {
  background: var(--selected);
}
.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 8px;
  color: var(--text-dim);
  background: var(--bg-elev-2);
}
.icon.quick {
  color: var(--accent);
}
.icon.host {
  color: var(--ok);
}
.text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.title {
  font-size: 13.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 11.5px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Only addresses and command text are monospace; a sentence set in the mono
   face spaces every Chinese character apart. */
.sub.mono {
  font-family: var(--font-mono);
}
.sub-tail {
  font-family: var(--font-ui);
}
.match {
  background: transparent;
  color: var(--accent);
  font-weight: 600;
}
.edit {
  display: inline-flex;
  align-items: center;
  /* Always there (dimmed), so editing is discoverable without first landing
     on the row. */
  opacity: 0.45;
  color: var(--text-faint);
  padding: 4px;
  border-radius: 5px;
  transition: opacity 0.12s, color 0.12s, background 0.12s;
}
.row:hover .edit,
.row.sel .edit {
  opacity: 1;
}
.edit:hover {
  color: var(--text);
  background: var(--border-strong);
}
.empty {
  padding: 24px;
  text-align: center;
  color: var(--text-faint);
}
.empty-icon {
  display: flex;
  justify-content: center;
  margin-bottom: 8px;
  color: var(--text-faint);
}
.hint {
  display: flex;
  gap: 16px;
  padding: 9px 16px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-faint);
}
.hint .kbd {
  margin-right: 3px;
}
.hint {
  align-items: center;
}
/* The way to add a host is a real button, not a footnote: full-size label, a frame, the primary colour on hover. */
.hint-new {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin: -4px 0 -4px auto;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  color: var(--text);
  background: var(--bg-elev-2);
  border: 1px solid var(--border-strong);
}
.hint-new:hover {
  background: var(--selected);
  border-color: var(--text-faint);
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 12%, transparent);
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.pw-head {
  padding: 14px 18px 0;
}
.pw-title {
  font-size: 13px;
  color: var(--text-dim);
}
.pw-remember {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 18px 0;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
}
.pw-remember input {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
  cursor: pointer;
}
</style>
