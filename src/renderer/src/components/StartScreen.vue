<script setup lang="ts">
import { computed, ref } from 'vue'
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

const recent = computed(() =>
  [...store.hosts].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 4)
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
function onEnter(e: KeyboardEvent): void {
  if (isImeKey(e)) return
  e.preventDefault()
  const q = typed.value.trim()
  // A name, not an address: the one saved host it matches opens; anything else (none, or
  // several) goes to the palette with the text already typed in.
  if (q && !q.includes('@')) {
    const hits = store.hosts.filter((h) => h.label.toLowerCase().includes(q.toLowerCase()))
    const exact = store.hosts.find((h) => h.label.toLowerCase() === q.toLowerCase() || h.host.toLowerCase() === q.toLowerCase())
    const one = exact ?? (hits.length === 1 ? hits[0] : undefined)
    if (one) {
      typed.value = ''
      return void open(one)
    }
    if (hits.length > 1) {
      typed.value = ''
      store.paletteSeed = q
      store.togglePalette(true)
      return
    }
  }
  const target = q ? parseTarget(q) : null
  if (!target) {
    store.togglePalette(true)
    return
  }
  const host = target.host.toLowerCase()
  const saved = store.hosts.find((h) => h.host.toLowerCase() === host && (!target.username || h.username === target.username))
  typed.value = ''
  if (saved) return void open(saved)
  store.paletteSeed = `${target.username ?? 'root'}@${target.host}${target.port !== 22 ? ':' + target.port : ''}`
  store.paletteQuick = true
  store.togglePalette(true)
}
</script>

<template>
  <div class="start">
    <div class="col">
      <div class="brand">
        <BrandLockup :height="22" />
      </div>
      <label class="go">
        <input v-model="typed" spellcheck="false" autocomplete="off" :placeholder="t('start.ph')" :aria-label="t('start.ph')" @keydown.enter="onEnter" />
        <kbd>Enter</kbd>
      </label>

      <template v-if="recent.length">
        <h2>{{ t('start.recent') }}</h2>
        <!-- One line each, like the palette: the rail beside this page is the full list. -->
        <div class="list">
          <button v-for="h in recent" :key="h.id" class="item" :class="{ busy: busy === h.id }" :title="address(h)" @click="open(h)">
            <b>{{ h.label }}</b>
            <small>{{ address(h) }}</small>
            <span v-if="h.lastUsedAt" class="when">{{ formatAgo(h.lastUsedAt, t) }}</span>
          </button>
        </div>
      </template>
      <div v-else class="none">
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
  margin: 22px 0 4px 10px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-faint);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 1px;
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
.item b {
  flex: 0 1 auto;
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
  margin: 24px 0 0 10px;
  font-size: 14px;
  color: var(--text-dim);
}
.keys {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: 26px 0 0 10px;
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
