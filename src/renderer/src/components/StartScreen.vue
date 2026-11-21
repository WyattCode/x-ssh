<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { parseTarget } from '../lib/target'
import { isImeKey } from '../lib/ime'
import { formatAgo } from '../lib/transferFormat'
import { isMac } from '../composables/platform'
import type { Host } from '../../../shared/types'
import Icon from './Icon.vue'
import OsIcon from './OsIcon.vue'
import BrandLockup from './BrandLockup.vue'

// What the terminal area shows when no session is open: the way in. Recent hosts
// to click, an address to type, and the three shortcuts that run the rest of the
// app. (The 连接 page used to be a page of its own; the host rail is the list now.)
const emit = defineEmits<{ (e: 'new-host'): void }>()
const store = useSessions()
const { t } = useI18n()
const mod = isMac ? '⌘' : 'Ctrl'

const recent = computed(() =>
  [...store.hosts].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 8)
)
const address = (h: Host): string => `${h.username}@${h.host}${h.port && h.port !== 22 ? ':' + h.port : ''}`
const reachOf = (h: Host): string => {
  const r = store.reach[h.id]
  return r === 'online' || r === 'offline' ? r : ''
}

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
        <BrandLockup :height="24" />
      </div>
      <p class="sub">{{ t('start.sub') }}</p>
      <label class="go">
        <Icon name="terminal" :size="18" />
        <input v-model="typed" spellcheck="false" autocomplete="off" placeholder="user@host" aria-label="user@host" @keydown.enter="onEnter" />
        <kbd>Enter</kbd>
      </label>

      <template v-if="recent.length">
        <h2>{{ t('start.recent') }}</h2>
        <div class="grid">
          <button v-for="h in recent" :key="h.id" class="card" :class="{ busy: busy === h.id }" @click="open(h)">
            <span class="os">
              <OsIcon :os="h.os" :color="h.color" :size="36" />
              <span class="dot" :class="reachOf(h)" />
            </span>
            <span class="txt">
              <b>{{ h.label }}</b>
              <small>{{ address(h) }}</small>
            </span>
            <span v-if="h.lastUsedAt" class="when">{{ formatAgo(h.lastUsedAt, t) }}</span>
          </button>
        </div>
        <p v-if="store.hosts.length > recent.length" class="more">{{ t('start.all') }} · {{ store.hosts.length }}</p>
      </template>
      <div v-else class="none">
        <p>{{ t('start.empty') }}</p>
        <button class="btn btn-primary" @click="emit('new-host')">{{ t('rail.new') }}</button>
      </div>

      <ul class="keys">
        <li><kbd>{{ mod }}</kbd><kbd>K</kbd>{{ t('start.palette') }}</li>
        <li><kbd>{{ mod }}</kbd><kbd>B</kbd>{{ t('start.rail') }}</li>
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
.col {
  width: min(760px, 100%);
  padding: 9vh 32px 40px;
}
.brand {
  display: flex;
  align-items: center;
  color: var(--text);
}
.sub {
  margin: 14px 0 20px;
  font-size: 14px;
  color: var(--text-dim);
}
.go {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 46px;
  padding: 0 14px;
  color: var(--text-faint);
  background: var(--bg-elev-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: text;
}
.go:focus-within {
  border-color: var(--text);
  color: var(--text);
}
.go input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font: inherit;
  font-size: 15px;
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
  height: 22px;
  padding: 0 7px;
  margin-right: 6px;
  font: inherit;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 5px;
}
h2 {
  margin: 30px 0 10px;
  font-size: 13px;
  font-weight: 400;
  color: var(--text-faint);
}
h2::before {
  content: '# ';
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}
.card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  text-align: left;
  color: var(--text);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  transition: background 0.15s, border-color 0.15s;
}
.card:hover {
  background: var(--bg-elev-2);
  border-color: var(--border-strong);
}
.card.busy {
  opacity: 0.6;
}
.os {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
}
.dot {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid var(--bg-elev);
  background: transparent;
}
.dot.online {
  background: var(--ok);
}
.dot.offline {
  background: var(--text-faint);
}
.txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.txt b {
  font-size: 14.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.txt small {
  font-size: 12.5px;
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
.more {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--text-faint);
}
.none {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  margin-top: 30px;
  font-size: 14px;
  color: var(--text-dim);
}
.keys {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin-top: 36px;
  padding-top: 16px;
  list-style: none;
  font-size: 12.5px;
  color: var(--text-faint);
  border-top: 1px solid var(--chrome-line);
}
.keys li {
  display: flex;
  align-items: center;
}
</style>
