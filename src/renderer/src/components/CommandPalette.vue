<script setup lang="ts">
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'
const trapEl = ref<HTMLElement>()
useFocusTrap(trapEl, () => store.paletteOpen)
import { useSessions } from '../stores/sessions'
import { fuzzyScore, fuzzyMatch } from '../lib/fuzzy'
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
  | { kind: 'host'; title: string; sub: string; host: Host; known: boolean }
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
    t('pal.hosts'),
    scored.map(({ h }) => ({
      kind: 'host' as const,
      title: h.label,
      sub: `${h.username}@${h.host}:${h.port}${h.group ? ` · ${h.group}` : ''}`,
      host: h,
      known: store.hostKeyKnown(h.host, h.port)
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
      res.error === 'missing-config' ? t('set.sec.importSshMissing') : (res.error ?? t('set.sec.importFail')),
      'error'
    )
    return
  }
  store.togglePalette(false)
  await store.loadHosts()
  await store.loadKnownHosts()
  if (res.count > 0) toast(t('set.sec.importSshOk', { n: res.count }), 'success')
  else toast(t('set.sec.importSshNone'), 'info')
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
          store.hosts = await window.api.hosts.save({ ...toRaw(h) }, password.value)
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
    e.preventDefault()
    const item = items.value[selected.value]
    if (item) activate(item)
  } else if (e.key === 'Escape') {
    store.togglePalette(false)
  }
}
</script>

<template>
  <div v-if="store.paletteOpen" class="overlay" @mousedown.self="onOverlayDismiss">
    <div ref="trapEl" tabindex="-1" class="palette" @keydown="onKey">
      <!-- Broadcast command prompt -->
      <template v-if="broadcastOpen">
        <div class="pw-head">
          <span class="pw-title">{{ t('pal.broadcast') }}</span>
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
                <span class="sub">
                  <template v-for="(seg, sk) in highlight(item.sub, qTrim)" :key="'s' + sk">
                    <mark v-if="seg.hit" class="match">{{ seg.text }}</mark>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </span>
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
          <span><span class="kbd">Enter</span> {{ t('pal.connect') }}</span>
          <span><span class="kbd">Esc</span> {{ t('pal.close') }}</span>
        </div>
      </template>
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
  align-items: flex-start;
  padding-top: 12vh;
  z-index: 100;
  animation: fade-in 0.12s ease;
}
.palette {
  width: min(620px, 92vw);
  background-color: color-mix(in srgb, var(--bg-elev) 90%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  overflow: hidden;
  animation: pop-in 0.16s cubic-bezier(0.2, 0.8, 0.3, 1);
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
  font-size: 10.5px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.key-badge {
  margin-left: 7px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
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
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.match {
  background: transparent;
  color: var(--accent);
  font-weight: 600;
}
.edit {
  display: inline-flex;
  align-items: center;
  opacity: 0;
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
