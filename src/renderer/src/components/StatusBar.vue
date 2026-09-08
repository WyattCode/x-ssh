<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import Icon from './Icon.vue'

const store = useSessions()
const { t } = useI18n()

const pane = computed(() => store.activePane)
const tab = computed(() => store.active)
const connected = computed(() => pane.value?.status === 'connected')

// Uptime of the current live session, reset whenever the tracked pane changes.
const connectedAt = ref<number | null>(null)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
watch(
  () => [pane.value?.id, connected.value] as const,
  ([id, isConn]) => {
    connectedAt.value = isConn ? Date.now() : null
  },
  { immediate: true }
)
if (typeof window !== 'undefined') {
  timer = setInterval(() => (now.value = Date.now()), 1000)
}
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const hostLabel = computed(() => {
  const p = pane.value?.params
  if (!p) return ''
  const portText = p.port !== 22 ? `:${p.port}` : ''
  return `${p.username}@${p.host}${portText}`
})
const uptime = computed(() => {
  if (!connectedAt.value) return ''
  const s = Math.max(0, Math.floor((now.value - connectedAt.value) / 1000))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return mm > 0 ? `${mm}m${ss}s` : `${s}s`
})
const forwards = computed(() => pane.value?.params.portForwards?.length ?? 0)
const forwardList = computed(() => pane.value?.params.portForwards ?? [])
const fwOpen = ref(false)
const modeLabel = (m: string): string => (m === 'local' ? t('status.fwLocal') : m === 'remote' ? t('status.fwRemote') : t('status.fwDynamic'))
const hasJump = computed(() => !!pane.value?.params.jumpHostId)
const keyKnown = computed(() => {
  const p = pane.value?.params
  if (!p) return undefined
  return store.hostKeyKnown(p.host, p.port || 22)
})

// Host color accent for the current tab, if any.
const accent = computed(() => {
  const id = tab.value?.hostId
  return id ? store.hosts.find((h) => h.id === id)?.color : undefined
})

// Running SFTP transfers across all panes (opens the global transfers panel).
const activeTransfers = computed(() => store.transfers.filter((x) => !x.done && !x.error))
</script>

<template>
  <div class="statusbar">
    <span v-if="hostLabel" class="seg host" :style="{ '--accent': accent }">
      <span class="accent" />
      <span class="host-text">{{ hostLabel }}</span>
      <span v-if="uptime" class="uptime">{{ uptime }}</span>
    </span>
    <span v-else class="seg dim">{{ t('status.none') }}</span>

    <span class="grow" />

    <button
      v-if="activeTransfers.length"
      class="seg badge xfer"
      :class="{ on: store.transferPanelOpen }"
      :title="t('tpanel.title')"
      @click="store.toggleTransferPanel()"
    >
      <Icon name="download" :size="12" />
      <span>{{ activeTransfers.length }}</span>
    </button>

    <span v-if="hasJump" class="seg badge" :title="t('status.jumpTip')">
      <Icon name="server" :size="12" />
      <span>{{ t('status.jump') }}</span>
    </span>
    <button
      v-if="forwards > 0"
      class="seg badge"
      :class="{ on: fwOpen }"
      :title="t('status.forwardsTip', { n: forwards })"
      @click="fwOpen = !fwOpen"
    >
      <Icon name="split" :size="12" />
      <span>{{ forwards }} {{ t('status.forwards') }}</span>
    </button>
    <span
      v-if="keyKnown !== undefined"
      class="seg badge"
      :class="keyKnown ? 'ok' : 'warn'"
      :title="keyKnown ? t('status.trustedTip') : t('status.unknownTip')"
    >
      <Icon :name="keyKnown ? 'shield' : 'alert-triangle'" :size="12" />
    </span>
  </div>

  <div v-if="fwOpen" class="fw-overlay" @mousedown.self="fwOpen = false">
    <div class="fw-pop">
      <div class="fw-head">{{ t('status.forwardsTitle') }}</div>
      <div v-for="(f, i) in forwardList" :key="i" class="fw-row">
        <span class="fw-badge">{{ modeLabel(f.mode ?? 'local') }}</span>
        <span class="fw-rule">
          {{ f.mode === 'dynamic' ? 'SOCKS local' : '' }}
          {{ f.mode !== 'dynamic' ? `${f.localPort} → ${f.remoteHost || '127.0.0.1'}:${f.remotePort}` : '' }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 10px;
  font-size: 11px;
  background: var(--bg-elev);
  border-top: 1px solid var(--border);
  color: var(--text-dim);
  user-select: none;
}
.seg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.seg.dim {
  color: var(--text-faint);
}
.seg.host {
  font-family: var(--font-mono);
}
.accent {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}
.uptime {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}
.badge {
  gap: 4px;
  padding: 1px 7px;
  border-radius: 5px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.badge.ok {
  color: var(--ok);
}
.badge.warn {
  color: var(--warn);
}
.badge.xfer {
  cursor: pointer;
}
.badge.xfer.on {
  color: var(--accent);
}
.grow {
  flex: 1;
}
.fw-overlay {
  position: fixed;
  inset: 0;
  z-index: 96;
}
.fw-pop {
  position: fixed;
  right: 10px;
  bottom: 32px;
  min-width: 240px;
  max-width: 340px;
  padding: 8px;
  background-color: color-mix(in srgb, var(--bg-elev) 96%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.fw-head {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-dim);
  padding: 2px 6px 8px;
}
.fw-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-top: 1px solid var(--border);
}
.fw-badge {
  flex: none;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: capitalize;
}
.fw-rule {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
