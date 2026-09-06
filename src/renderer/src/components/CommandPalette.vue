<script setup lang="ts">
import { computed, nextTick, ref, toRaw, watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { fuzzyScore } from '../lib/fuzzy'
import { parseTarget } from '../lib/target'
import { useI18n } from '../lib/i18n'
import Icon from './Icon.vue'
import type { ConnectParams, Host, Snippet } from '../../../shared/types'

const store = useSessions()
const { t } = useI18n()
const emit = defineEmits<{
  (e: 'new-host'): void
  (e: 'edit-host', h: Host): void
}>()

type Item =
  | { kind: 'quick'; title: string; sub: string; params: ConnectParams }
  | { kind: 'host'; title: string; sub: string; host: Host; known: boolean }
  | { kind: 'snippet'; title: string; sub: string; snippet: Snippet }
  | { kind: 'action'; title: string; sub: string; run: () => void; icon: string }

const query = ref('')
const selected = ref(0)
const inputEl = ref<HTMLInputElement>()

// Inline password prompt state.
const pending = ref<{ params: ConnectParams; title: string } | null>(null)
const password = ref('')
const remember = ref(true)
const pwEl = ref<HTMLInputElement>()

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 60)

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
      score: q
        ? Math.max(fuzzyScore(q, h.label), fuzzyScore(q, `${h.username}@${h.host}`))
        : (h.lastUsedAt ?? 0) / 1e13
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

  const snips = store.snippets.filter(
    (s) => !q || fuzzyScore(q, s.title) > -1 || fuzzyScore(q, s.text) > -1
  )
  add(
    'snippets',
    t('pal.snippets'),
    snips.map((s) => ({
      kind: 'snippet' as const,
      title: s.title,
      sub: oneLine(s.text),
      snippet: s
    }))
  )

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
  add('actions', t('pal.actions'), actions)

  // Named session snapshots: capture & restore the whole tab layout.
  if (store.snapshots.length || true) {
    const snaps: Item[] = []
    snaps.push({
      kind: 'action',
      title: t('pal.snapSave'),
      sub: t('pal.snapSaveDesc'),
      icon: 'book',
      run: () => void store.saveSnapshot(`${t('pal.snapDefault')} ${new Date().toLocaleTimeString()}`)
    })
    for (const s of store.snapshots) {
      snaps.push({
        kind: 'action',
        title: s.name,
        sub: new Date(s.savedAt).toLocaleString(),
        icon: 'zap',
        run: () => void store.openSnapshot(s.id)
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

/** Imports hosts from ~/.ssh/config, then refreshes the list + security cache. */
async function importSshConfig(): Promise<void> {
  const res = await window.api.hosts.importSshConfig()
  if (res.ok) {
    store.togglePalette(false)
    await store.loadHosts()
    await store.loadKnownHosts()
  }
}
watch(
  () => store.paletteOpen,
  (open) => {
    if (open) {
      query.value = ''
      selected.value = 0
      pending.value = null
      password.value = ''
      remember.value = true
      nextTick(() => inputEl.value?.focus())
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
  } else {
    store.togglePalette(false)
    item.run()
  }
}

async function submitPassword(): Promise<void> {
  if (!pending.value) return
  const { params, title } = pending.value
  // Persist the password to the host (encrypted) so we don't prompt next time.
  if (remember.value && params.hostId && password.value) {
    const h = store.hosts.find((x) => x.id === params.hostId)
    if (h) store.hosts = await window.api.hosts.save({ ...toRaw(h) }, password.value)
  }
  connect({ ...params, password: password.value }, title)
}

function onKey(e: KeyboardEvent): void {
  // While an IME is composing, Enter/arrows/Esc are the candidate list's, not
  // ours — searching a Chinese host label would otherwise connect on the Enter
  // that just picks the word.
  if (e.isComposing || e.keyCode === 229) return
  if (pending.value) {
    if (e.key === 'Escape') {
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
  <div v-if="store.paletteOpen" class="overlay" @mousedown.self="store.togglePalette(false)">
    <div class="palette" @keydown="onKey">
      <!-- Password prompt -->
      <template v-if="pending">
        <div class="pw-head">
          <span class="pw-title">{{ t('pal.pwTitle', { user: pending.params.username, host: pending.params.host }) }}</span>
        </div>
        <input
          ref="pwEl"
          v-model="password"
          type="password"
          class="search"
          :placeholder="t('pal.pwPlaceholder')"
          @keydown.enter.prevent="submitPassword"
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
        <div class="list">
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
              <span class="icon" :class="item.kind">
                <Icon
                  :name="
                    item.kind === 'quick'
                      ? 'arrow-right'
                      : item.kind === 'host'
                        ? 'server'
                        : item.kind === 'snippet'
                          ? 'zap'
                          : item.icon
                  "
                  :size="15"
                />
              </span>
              <span class="text">
                <span class="title">
                  {{ item.title }}
                </span>
                <span class="sub">{{ item.sub }}</span>
              </span>
              <span
                v-if="item.kind === 'host'"
                class="edit"
                :title="t('pal.edit')"
                @click.stop="emit('edit-host', item.host); store.togglePalette(false)"
              ><Icon name="edit" :size="14" /></span>
            </button>
          </template>
          <div v-if="!items.length" class="empty">{{ t('pal.empty') }}</div>
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
  background: var(--accent-soft);
}
.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 6px;
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
