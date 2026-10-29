<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'
const trapEl = ref<HTMLElement>()
useFocusTrap(trapEl, () => store.historyOpen)
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { isImeKey } from '../lib/ime'
import Icon from './Icon.vue'

const store = useSessions()
const { t } = useI18n()

/** Missing / legacy-Chinese labels → localized untitled. */
function displayLabel(label: string): string {
  if (!label || label === '会话') return t('hist.untitled')
  return label
}

const query = ref('')
const inputEl = ref<HTMLInputElement>()
const active = ref(0)
/** History source filter ('' = all sessions). */
const hostFilter = ref('')
/** Stripped, flattened lines built once per load (not per keystroke). */
const lines = ref<{ sessionId: string; label: string; line: string }[]>([])

async function load(): Promise<void> {
  const sessions = await window.api.history.list()
  const flat: { sessionId: string; label: string; line: string }[] = []
  for (const s of sessions) {
    if (!s.text) continue
    for (const raw of strip(s.text).split('\n')) {
      const line = raw.trim()
      if (line) flat.push({ sessionId: s.sessionId, label: s.label, line })
    }
  }
  lines.value = flat
  // Keep the host filter choice in sync with the (re)loaded session set.
  const available = new Set(flat.map((l) => l.label))
  if (hostFilter.value && !available.has(hostFilter.value)) hostFilter.value = ''
}

/** Unique host lineages represented in the loaded history. */
const hostLabels = computed(() => {
  const set = new Set(lines.value.map((l) => l.label))
  return [...set]
})

watch(
  () => store.historyOpen,
  async (o) => {
    if (o) {
      query.value = ''
      hostFilter.value = ''
      active.value = 0
      await load()
      nextTick(() => inputEl.value?.focus())
    }
  }
)

/** Removes ANSI/OSC sequences so rendered lines are searchable text. */
function strip(s: string): string {
  return s
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

interface Hit {
  sessionId: string
  label: string
  line: string
}

/** Hard cap so a noisy session can't flood (or stall) the DOM. */
const MAX_RESULTS = 500

const results = computed<Hit[]>(() => {
  const q = query.value.trim().toLowerCase()
  const host = hostFilter.value
  const out: Hit[] = []
  for (const l of lines.value) {
    if (host && l.label !== host) continue
    if (q && !l.line.toLowerCase().includes(q)) continue
    out.push(l)
    if (out.length >= MAX_RESULTS) break
  }
  return out
})

// Refining the query can shrink the result set under the highlighted row:
// Enter then lands on nothing (silently). Keep the selection pinned to a
// real row.
watch(results, (r) => {
  if (active.value >= r.length) active.value = Math.max(0, r.length - 1)
})

/** Writes the current (filtered) results to a plaintext log via the main process. */
function exportLog(): void {
  const text = results.value.map((h) => `[${displayLabel(h.label)}] ${h.line}`).join('\n')
  void window.api.history.export(text)
}

function pick(hit: Hit): void {
  store.focusSession(hit.sessionId)
  store.toggleHistory(false)
}
function copy(hit: Hit): void {
  window.api.clipboard.writeText(hit.line)
  store.toggleHistory(false)
}
function onKey(e: KeyboardEvent): void {
  // While an IME is composing, Enter / arrows / Esc belong to the candidate
  // list: picking a word out of it would otherwise jump to that session and
  // close this dialog mid-typing.
  if (isImeKey(e)) return
  if (e.key === 'Escape') store.toggleHistory(false)
  else if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = Math.min(active.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  } else if (e.key === 'Enter' && results.value[active.value]) {
    e.preventDefault()
    pick(results.value[active.value])
  }
}
</script>

<template>
  <div v-if="store.historyOpen" class="overlay" @mousedown.self="store.toggleHistory(false)">
    <div ref="trapEl" tabindex="-1" class="panel" @keydown="onKey">
      <div class="bar">
        <Icon name="search" :size="15" />
        <input
          ref="inputEl"
          v-model="query"
          class="in"
          :placeholder="t('hist.placeholder')"
          spellcheck="false"
          autocomplete="off"
        />
        <select v-model="hostFilter" class="hostsel" :title="t('hist.hostFilter')">
          <option value="">{{ t('hist.allHosts') }}</option>
          <option v-for="h in hostLabels" :key="h" :value="h">{{ displayLabel(h) }}</option>
        </select>
        <span class="count" :title="results.length >= MAX_RESULTS ? t('hist.truncated') : undefined">
          {{ results.length >= MAX_RESULTS ? MAX_RESULTS + '+' : results.length }}
        </span>
        <button class="iconbtn" :title="t('hist.export')" @click="exportLog"><Icon name="download" :size="14" /></button>
        <button class="close" :title="t('hist.close')" @click="store.toggleHistory(false)"><Icon name="close" :size="15" /></button>
      </div>

      <div class="list">
        <div v-if="!results.length" class="empty">{{ t('hist.empty') }}</div>
        <button
          v-for="(hit, i) in results"
          :key="i"
          class="row"
          :class="{ on: i === active }"
          @mousemove="active = i"
          @click="pick(hit)"
        >
          <span class="label">{{ displayLabel(hit.label) }}</span>
          <span class="line">{{ hit.line }}</span>
          <span class="arch" :title="t('hist.copy')" @click.stop="copy(hit)"><Icon name="copy" :size="13" /></span>
        </button>
      </div>

      <div class="foot">
        <span><span class="kbd">↑</span><span class="kbd">↓</span> {{ t('pal.nav') }}</span>
        <span><span class="kbd">Enter</span> {{ t('hist.goto') }}</span>
        <span><span class="kbd">Esc</span> {{ t('pal.close') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}
.panel {
  width: 720px;
  max-width: 92vw;
  max-height: 68vh;
  display: flex;
  flex-direction: column;
  background-color: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  animation: pop-in 0.16s cubic-bezier(0.2, 0.8, 0.3, 1);
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
}
.in {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
}
.count {
  font-size: 11px;
  color: var(--text-faint);
}
.close {
  display: flex;
  padding: 3px;
  border-radius: 5px;
  color: var(--text-faint);
}
.close:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.iconbtn {
  display: flex;
  padding: 3px;
  border-radius: 5px;
  color: var(--text-faint);
}
.iconbtn:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.hostsel {
  max-width: 170px;
  height: 28px;
  padding: 0 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12px;
  outline: none;
  appearance: auto;
  cursor: pointer;
}
.list {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.empty {
  padding: 30px;
  text-align: center;
  color: var(--text-faint);
  font-size: 13px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 14px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.row.on {
  background: var(--accent-soft);
}
.label {
  flex: none;
  min-width: 150px;
  max-width: 180px;
  color: var(--accent);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.line {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono, monospace);
}
.arch {
  flex: none;
  display: none;
  color: var(--text-faint);
}
.row:hover .arch,
.row.on .arch {
  display: inline-flex;
}
.arch:hover {
  color: var(--text);
}
.foot {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  font-size: 11.5px;
  color: var(--text-faint);
  border-top: 1px solid var(--border);
}
.kbd {
  padding: 1px 5px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 10.5px;
  margin-right: 2px;
}
</style>
