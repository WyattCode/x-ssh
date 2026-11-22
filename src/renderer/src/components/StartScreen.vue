<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { parseTarget } from '../lib/target'
import { isImeKey } from '../lib/ime'
import { formatAgo } from '../lib/transferFormat'
import { isMac } from '../composables/platform'
import type { Host } from '../../../shared/types'
import BrandLockup from './BrandLockup.vue'

// What the terminal area shows when no session is open: the way in. Recent hosts
// to click, an address to type, and the three shortcuts that run the rest of the
// app. (The 连接 page used to be a page of its own; the host rail is the list now.)
const emit = defineEmits<{ (e: 'new-host'): void }>()
const store = useSessions()
const { t } = useI18n()
const mod = isMac ? '⌘' : 'Ctrl'

/** Only hosts that were actually used: a list called "recent" does not pad itself with
 *  hosts never connected. With none, the section is not shown at all. */
const recent = computed(() =>
  store.hosts
    .filter((h) => h.lastUsedAt)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, 4)
)
const address = (h: Host): string => `${h.username}@${h.host}${h.port && h.port !== 22 ? ':' + h.port : ''}`

const typed = ref('')
const busy = ref('')
async function open(h: Host): Promise<void> {
  if (busy.value) return
  busy.value = h.id
  try {
    store.setSftpFull(false)
    if ((await store.quickConnect(h)) === 'needs-password') store.askPasswordFor(h)
    else store.focusTerminal()
  } finally {
    busy.value = ''
  }
}

// ---- What the typed text would do, shown before Enter ----
// Typing used to act blind: text contained in exactly one saved name connected to that
// host at once, even when a new address was meant. Now the matches are listed under the
// field, with "connect as a new address" as an entry of its own, and Enter takes the
// highlighted one.
type Suggestion = { kind: 'host'; host: Host } | { kind: 'new'; text: string }
const suggestions = computed<Suggestion[]>(() => {
  const q = typed.value.trim()
  if (!q) return []
  const lq = q.toLowerCase()
  const rank = (h: Host): number => {
    const label = h.label.toLowerCase()
    const addr = address(h).toLowerCase()
    if (label === lq || addr === lq || h.host.toLowerCase() === lq) return 0
    if (label.startsWith(lq)) return 1
    if (label.includes(lq)) return 2
    if (addr.includes(lq)) return 3
    return -1
  }
  const hosts = store.hosts
    .map((h) => ({ h, r: rank(h) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || (b.h.lastUsedAt ?? 0) - (a.h.lastUsedAt ?? 0))
    .slice(0, 5)
  const out: Suggestion[] = hosts.map((x) => ({ kind: 'host', host: x.h }))
  // parseTarget treats a bare word (no dot, user or port) as a search term. Here it is offered
  // as an address too — last in the list — so a new host called "prod" can still be reached.
  const target = parseTarget(q) ?? (/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(q) ? { username: undefined, host: q, port: 22 } : null)
  if (target) {
    const text = `${target.username ?? 'root'}@${target.host}${target.port !== 22 ? ':' + target.port : ''}`
    // Not when it is exactly a saved host's own address: that host is already in the list.
    if (!store.hosts.some((h) => address(h).toLowerCase() === text.toLowerCase())) out.push({ kind: 'new', text })
  }
  return out
})
const sel = ref(0)
watch(typed, () => {
  sel.value = 0
})
watch(suggestions, (list) => {
  if (sel.value >= list.length) sel.value = 0
})
function activate(sg: Suggestion | undefined): void {
  if (!sg) {
    // Nothing to pick here: hand what was typed (if anything) to the palette, which also
    // searches actions and snippets.
    const q = typed.value.trim()
    if (q) store.paletteSeed = q
    typed.value = ''
    store.togglePalette(true)
    return
  }
  typed.value = ''
  if (sg.kind === 'host') return void open(sg.host)
  store.paletteSeed = sg.text
  store.paletteQuick = true
  store.togglePalette(true)
}
function onKey(e: KeyboardEvent): void {
  if (isImeKey(e)) return
  const n = suggestions.value.length
  if (e.key === 'Enter') {
    e.preventDefault()
    activate(suggestions.value[sel.value])
  } else if (e.key === 'ArrowDown' && n) {
    e.preventDefault()
    sel.value = (sel.value + 1) % n
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    sel.value = (sel.value - 1 + n) % n
  } else if (e.key === 'Escape' && typed.value) {
    e.preventDefault()
    typed.value = ''
  }
}
</script>

<template>
  <div class="start">
    <div class="col">
      <div class="brand">
        <BrandLockup :height="22" />
      </div>
      <label class="go">
        <input v-model="typed" spellcheck="false" autocomplete="off" :placeholder="t('start.ph')" :aria-label="t('start.ph')" @keydown="onKey" />
        <kbd>Enter</kbd>
      </label>

      <!-- While typing: what Enter would do, in place of the recent list. -->
      <div v-if="typed.trim()" class="list sugg" role="listbox">
        <button
          v-for="(sg, i) in suggestions"
          :key="sg.kind === 'host' ? sg.host.id : 'new'"
          type="button"
          role="option"
          class="item"
          :class="{ sel: i === sel }"
          :aria-selected="i === sel"
          tabindex="-1"
          @mousemove="sel = i"
          @click="activate(sg)"
        >
          <template v-if="sg.kind === 'host'">
            <b>{{ sg.host.label }}</b>
            <small>{{ address(sg.host) }}</small>
          </template>
          <template v-else>
            <b>{{ sg.text }}</b>
            <small>{{ t('start.asNew') }}</small>
          </template>
          <span v-if="i === sel" class="verb">{{ sg.kind === 'host' ? t('pal.connect') : t('start.newConn') }} ↵</span>
        </button>
        <p v-if="!suggestions.length" class="nohit">{{ t('rail.none') }}</p>
      </div>
      <template v-else-if="recent.length">
        <h2>{{ t('start.recent') }}</h2>
        <!-- One line each, like the palette: the rail beside this page is the full list. -->
        <div class="list">
          <button v-for="h in recent" :key="h.id" class="item" :class="{ busy: busy === h.id }" :title="address(h)" @click="open(h)">
            <b>{{ h.label }}</b>
            <small>{{ address(h) }}</small>
            <span class="when">{{ formatAgo(h.lastUsedAt ?? 0, t) }}</span>
          </button>
        </div>
      </template>
      <div v-else-if="!store.hosts.length" class="none">
        <p>{{ t('start.empty') }}</p>
        <button class="btn btn-primary" @click="emit('new-host')">{{ t('rail.new') }}</button>
      </div>

      <ul class="keys">
        <li><kbd>{{ mod }} K</kbd>{{ t('start.palette') }}</li>
        <li><kbd>{{ mod }} B</kbd>{{ t('start.rail') }}</li>
        <li><kbd>Shift</kbd>{{ t('start.split') }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.start {
  position: absolute;
  inset: 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  justify-content: center;
  background: var(--console);
  font-family: var(--font-chrome);
}
/* Centred in the page, a little above the middle. */
.col {
  width: min(520px, 100%);
  min-height: 100%;
  padding: 32px 32px 12vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.brand {
  display: flex;
  align-items: center;
  color: var(--text);
  margin-bottom: 20px;
}
/* The same hairline field as the rail's search and the host dialog. */
.go {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 6px 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  cursor: text;
}
.go:hover {
  border-color: var(--text-faint);
}
.go:focus-within {
  border-color: var(--text);
}
.go input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font: inherit;
  font-size: 14px;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
  caret-color: var(--cursor);
  user-select: text;
}
.go input::placeholder {
  color: var(--text-faint);
}
kbd {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  margin-right: 6px;
  font: inherit;
  font-size: 11.5px;
  color: var(--text-dim);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
}
.go kbd {
  margin-right: 0;
  color: var(--text-faint);
}
h2 {
  margin: 22px 0 4px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-faint);
}
/* Rows are inset by their own padding and pulled back out by the same amount, so their TEXT
   lines up with the logo and the field above, while the hover tile spills a little past it. */
.list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0 -10px;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 34px;
  padding: 0 10px;
  text-align: left;
  border-radius: var(--radius-sm);
}
.item:hover,
.item:focus-visible {
  background: var(--hover);
}
.item.busy {
  opacity: 0.6;
}
/* A fixed name column: every address starts at the same x. */
.item b {
  flex: 0 0 190px;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 400;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item small {
  flex: 1 1 0;
  min-width: 0;
  font-size: 12px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sugg {
  margin-top: 6px;
}
.item.sel {
  background: var(--selected);
}
.verb {
  flex: none;
  font-size: 12px;
  color: var(--ok);
}
.nohit {
  margin: 8px 10px;
  font-size: 12.5px;
  color: var(--text-faint);
}
.when {
  flex: none;
  font-size: 12px;
  color: var(--text-faint);
}
.none {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin: 24px 0 0;
  font-size: 14px;
  color: var(--text-dim);
}
.keys {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: 26px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--text-faint);
}
.keys li {
  display: flex;
  align-items: center;
}
</style>
