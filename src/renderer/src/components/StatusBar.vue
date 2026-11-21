<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { liveForwardCount } from '../lib/forwards'
import { routeOf } from '../lib/route'
import Icon from './Icon.vue'

const store = useSessions()
const { t } = useI18n()

const pane = computed(() => store.activePane)
const tab = computed(() => store.active)
const connected = computed(() => pane.value?.status === 'connected')

// Uptime of the current live session.
//
// The start time is kept PER PANE: the old code stamped `Date.now()` every time
// the tracked pane changed, so switching to a tab that had been connected for
// an hour restarted its uptime at 0s — the number shown was "time since you
// last looked", not "time connected". Entries are dropped when the pane leaves
// `connected`, so a reconnect starts a fresh count.
const connectedAtByPane = new Map<string, { at: number; sshSessionId?: string }>()
const connectedAt = ref<number | null>(null)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
/** The link a pane is on, so a reconnect under the same pane id is noticed
 *  even if it happened while another pane was being watched. */
const linkOf = (p: { sshSessionId?: string } | undefined): string | undefined => p?.sshSessionId
watch(
  () => [pane.value?.id, pane.value?.status, linkOf(pane.value)] as const,
  ([id, status, link]) => {
    if (!id) {
      connectedAt.value = null
      return
    }
    if (status === 'connected') {
      let entry = connectedAtByPane.get(id)
      // A new ssh session id means a new connection: restart the count.
      if (!entry || entry.sshSessionId !== link) {
        entry = { at: Date.now(), sshSessionId: link }
        connectedAtByPane.set(id, entry)
      }
      connectedAt.value = entry.at
    } else {
      connectedAtByPane.delete(id)
      connectedAt.value = null
    }
    // Forget panes that no longer exist at all (tab closed, pane split away).
    for (const k of connectedAtByPane.keys()) {
      if (!store.tabs.some((t) => t.panes.some((p) => p.id === k))) connectedAtByPane.delete(k)
    }
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
// 本机 › 跳板 › 目标: the path the session really takes, and how long a round trip
// over it takes (measured by main; a dash until the first reading arrives).
const targetName = computed(() => {
  const p = pane.value?.params
  if (!p) return ''
  const h = p.hostId ? store.hosts.find((x) => x.id === p.hostId) : undefined
  return h?.label ?? `${p.username}@${p.host}`
})
const route = computed(() => (pane.value ? routeOf(pane.value.params, store.hosts) : { hops: [], direct: true }))
const latency = computed(() => {
  const id = pane.value?.sshSessionId
  return id && connected.value ? store.latency[id] : undefined
})
const uptime = computed(() => {
  if (!connectedAt.value) return ''
  const s = Math.max(0, Math.floor((now.value - connectedAt.value) / 1000))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return mm > 0 ? `${mm}m${ss}s` : `${s}s`
})
// Saved host rules are opened by main on connect and never land in
// pane.params.portForwards — count the running rows of the forward groups
// instead, so the badge matches the 端口转发 page.
const forwards = computed(() => liveForwardCount(store.forwardGroups, pane.value))
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

// Running SFTP transfers across all panes (opens the global transfers panel).
const activeTransfers = computed(() => store.transfers.filter((x) => !x.done && !x.error))
</script>

<template>
  <div class="statusbar">
    <span v-if="hostLabel" class="seg host">
      <span class="link" :class="linkState" :title="t(linkTip)" />
      <span class="host-text" :title="hostLabel">
        <template v-for="(hop, i) in [t('status.local'), ...route.hops]" :key="i">{{ hop }}<span class="sep"> › </span></template><b>{{ targetName }}</b>
      </span>
      <span v-if="latency" class="latency">{{ latency }} ms</span>
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
  height: var(--band-bot);
  flex: none;
  padding: 0 16px;
  font-family: var(--font-chrome);
  font-size: 12.5px;
  background: var(--chrome);
  border-top: 1px solid var(--chrome-line);
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
.host-text .sep {
  color: var(--text-faint);
}
.host-text b {
  font-weight: 600;
  color: var(--text);
}
.latency {
  margin-left: 6px;
  color: var(--ok);
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
