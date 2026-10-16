<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { canRevealHistory } from '../lib/transferHistory'
import {
  pct as pctOf,
  formatBytes,
  formatSpeed,
  formatAgo
} from '../lib/transferFormat'
import type { SftpProgress, TransferHistoryItem } from '../../../shared/types'
import Icon from './Icon.vue'

const store = useSessions()
const { t } = useI18n()

// Paused job ids (in-memory, main-driven). Tracked here so the resume button
// shows only for paused rows, and a global "resume all" reflects the state.
const pausedIds = new Set<string>()
const allPaused = ref(false)

function togglePause(id: string): void {
  const paused = !pausedIds.has(id)
  if (paused) pausedIds.add(id)
  else pausedIds.delete(id)
  window.api.sftp.pause(id, paused)
}
function togglePauseAll(): void {
  allPaused.value = !allPaused.value
  // Bulk pause mirrors the main process's set: pause adds every active id,
  // resume clears them, so per-row icons stay truthful.
  if (allPaused.value) for (const x of active.value) pausedIds.add(x.id)
  else pausedIds.clear()
  window.api.sftp.pauseAll(allPaused.value)
}

// Live rows (all sessions), kept in arrival order.
const active = computed(() =>
  store.transfers.filter((x) => !x.done && !x.error)
)

// Recent finished transfers for the clean status badge.
const recent = computed(() => store.transferHistory.slice(0, 12))

function histStatus(h: TransferHistoryItem): string {
  if (h.status === 'cancelled') return t('sfp.cancelled')
  if (h.status === 'error') return h.error || t('sfp.failed')
  return t('sfp.done')
}
function reveal(h: TransferHistoryItem): void {
  const target =
    h.direction === 'down' ? h.localDir : h.localPaths?.[0]
  if (target) void window.api.sftp.revealLocal(target)
}
// History rows only expose "reveal" for finished down/up transfers.
function canReveal(h: TransferHistoryItem): boolean {
  return canRevealHistory(h) || (h.direction === 'up' && !!h.localPaths?.[0])
}
function timeAgo(at: number): string {
  return formatAgo(at, t)
}

function fmtBytes(n: number): string {
  return formatBytes(n)
}

function pct(t2: SftpProgress): number {
  return pctOf(t2)
}

function fmtSpeed(id: string): string {
  return formatSpeed(store.transferSpeeds[id])
}
</script>

<template>
  <div v-if="store.transferPanelOpen" class="tpanel-backdrop" @mousedown.self="store.toggleTransferPanel(false)">
    <section class="tpanel">
      <header class="tp-head">
        <span class="tp-title">{{ t('tpanel.title') }}</span>
        <button class="tp-x" title="Close" @click="store.toggleTransferPanel(false)">
          <Icon name="close" :size="16" />
        </button>
      </header>

      <div class="tp-body">
        <div class="tp-sec">
          <div class="tp-label">
            {{ t('tpanel.active') }}
            <button
              v-if="active.length"
              class="tp-pauseall"
              :title="allPaused ? t('tpanel.resumeAll') : t('tpanel.pauseAll')"
              @click="togglePauseAll"
            >
              <Icon :name="allPaused ? 'play' : 'pause'" :size="13" />
              <span>{{ allPaused ? t('tpanel.resumeAll') : t('tpanel.pauseAll') }}</span>
            </button>
          </div>
          <div v-if="active.length" class="tp-list">
            <div v-for="x in active" :key="x.id" class="tp-row">
              <Icon :name="x.direction === 'up' ? 'upload' : 'download'" :size="14" class="tp-dir" />
              <div class="tp-main">
                <div class="tp-name">{{ x.name }}</div>
                <div class="tp-track">
                  <div class="tp-fill" :style="{ width: pct(x) + '%' }"></div>
                </div>
                <div class="tp-meta">
                  <span>{{ fmtBytes(x.transferred) }}<template v-if="x.total"> / {{ fmtBytes(x.total) }}</template></span>
                  <span v-if="x.direction === 'down' && x.count && x.count > 1 && x.index">{{ x.index }}/{{ x.count }} · </span>
                  <span>{{ fmtSpeed(x.id) }}</span>
                </div>
              </div>
                <button class="tp-cancel" :title="t('sfp.pause')" @click="togglePause(x.id)">
                <Icon :name="pausedIds.has(x.id) ? 'play' : 'pause'" :size="14" />
              </button>
                <button class="tp-cancel" :title="t('sfp.cancelTransfer')" @click="store.cancelTransfer(x.id)">
                <Icon name="close" :size="14" />
              </button>
            </div>
          </div>
          <div v-else class="tp-none">{{ t('tpanel.none') }}</div>
        </div>

        <div class="tp-sec">
          <div class="tp-label">{{ t('sfp.history') }}</div>
          <div v-if="recent.length" class="tp-list">
            <div v-for="h in recent" :key="h.id" class="tp-row tp-hist">
              <Icon :name="h.direction === 'up' ? 'upload' : 'download'" :size="14" class="tp-dir" />
              <div class="tp-main">
                <div class="tp-name">{{ h.name }}</div>
                <div class="tp-meta">
                  <span class="tp-badge" :class="h.status">{{ histStatus(h) }}</span>
                  <span>{{ fmtBytes(h.bytes) }}</span>
                  <span class="tp-ago">· {{ timeAgo(h.at) }}</span>
                </div>
              </div>
              <button v-if="canReveal(h)" class="tp-cancel" :title="t('sfp.reveal')" @click="reveal(h)">
                <Icon name="folder" :size="14" />
              </button>
            </div>
          </div>
          <div v-else class="tp-none">{{ t('sfp.histEmpty') }}</div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tpanel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 12px;
}
.tpanel {
  width: 380px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.tp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.tp-title { font-size: 13px; font-weight: 600; }
.tp-x, .tp-cancel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  border-radius: 4px;
  cursor: pointer;
}
.tp-pauseall {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 2px 8px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}
.tp-pauseall:hover { background: var(--bg-elev-2); color: var(--text); }
.tp-x:hover, .tp-cancel:hover { background: var(--bg-elev-2); color: var(--text); }
.tp-body { overflow-y: auto; }
.tp-sec { padding: 8px 12px 12px; }
.tp-sec + .tp-sec { border-top: 1px solid var(--border); }
.tp-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  margin: 6px 0;
}
.tp-list { display: flex; flex-direction: column; gap: 6px; }
.tp-none { color: var(--text-dim); font-size: 12px; padding: 8px 0; }
.tp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  background: var(--bg-elev-2);
}
.tp-dir { color: var(--text-dim); flex: none; }
.tp-main { flex: 1; min-width: 0; }
.tp-name {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-track {
  height: 4px;
  border-radius: 2px;
  background: var(--bg);
  overflow: hidden;
  margin-top: 4px;
}
.tp-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.2s; }
.tp-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 3px;
}
.tp-ago { margin-left: auto; }
.tp-badge { font-weight: 600; }
.tp-badge.done { color: var(--ok, #3fb950); }
.tp-badge.error { color: var(--danger); }
.tp-badge.cancelled { color: var(--text-dim); }
</style>
