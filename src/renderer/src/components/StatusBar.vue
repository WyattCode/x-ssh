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
/** Link state of the tracked pane. The dot next to the host name follows this,
 *  never the host colour — a green host colour must not read as "connected"
 *  while the pane is sitting on a failed-connection card. Mirrors the four
 *  `SessionStatus` values; `idle` only covers "no pane yet". */
const linkState = computed(() => {
  const s = pane.value?.status
  if (s === 'connected') return 'connected'
  if (s === 'connecting') return 'connecting'
  if (s === 'error') return 'error'
  if (s === 'closed') return 'closed'
  return 'idle'
})
const linkTip = computed(
  () =>
    ({
      connected: 'status.linkConnected',
      connecting: 'status.linkConnecting',
      error: 'status.linkError',
      closed: 'status.linkClosed',
      idle: 'status.linkIdle'
    })[linkState.value]
)
const hasJump = computed(() => !!pane.value?.params.jumpHostId)
const keyKnown = computed(() => {
  const p = pane.value?.params
  if (!p) return undefined
  return store.hostKeyKnown(p.host, p.port || 22)
})

// Host colour for the current tab, if any (identity marker, not link state).
// Falls back to the accent colour, the same way host cards do.
const hostColor = computed(() => {
  const id = tab.value?.hostId
  return (id ? store.hosts.find((h) => h.id === id)?.color : undefined) || 'var(--accent)'
})

// Running SFTP transfers across all panes (opens the global transfers panel).
const activeTransfers = computed(() => store.transfers.filter((x) => !x.done && !x.error))
</script>

<template>
  <div class="statusbar">
    <span v-if="hostLabel" class="seg host" :style="{ '--host': hostColor }">
      <span class="host-bar" />
      <span class="link" :class="linkState" :title="t(linkTip)" />
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
      v-if="connected"
      class="seg badge"
      :class="{ on: store.forwardOpen }"
      :title="t('status.forwardsTip', { n: forwards })"
      @click="store.toggleForwards()"
    >
      <Icon name="split" :size="12" />
      <span v-if="forwards > 0">{{ forwards }} {{ t('status.forwards') }}</span>
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
  min-width: 0;
}
.seg.dim {
  color: var(--text-faint);
}
.seg.host {
  font-family: var(--font-mono);
  /* Long hostnames must not push the trailing badges out of the bar. */
  min-width: 0;
  overflow: hidden;
}
.host-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The host's own colour, kept as a thin bar so the identity marker is not
   mistaken for the link state (the dot beside it is the link state). */
.host-bar {
  width: 3px;
  height: 12px;
  border-radius: 1.5px;
  background: var(--host, var(--accent));
  flex: none;
}
.link {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.link.connected {
  background: var(--ok, #3fb950);
}
.link.connecting {
  background: var(--warn, #d29922);
}
.link.error {
  background: var(--danger, #f0616d);
}
/* A cleanly closed session (the user typed `exit`): ended, not failed. */
.link.closed {
  background: var(--text-dim);
}
.link.idle {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--text-faint);
  opacity: 0.8;
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
</style>
