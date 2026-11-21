<script setup lang="ts">
import { formatFingerprint } from '../../../shared/hostKey'
import { computed, ref, defineAsyncComponent } from 'vue'
import { useSessions, isTrustingPane } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { childSizes } from '../lib/paneLayout'
import { hostEnv } from '../lib/hostEnv'
import { connectActions, type ConnectAction } from '../lib/connectActions'
import type { LayoutNode } from '../lib/paneLayout'
import type { Tab } from '../stores/sessions'
import Icon from './Icon.vue'

const TerminalView = defineAsyncComponent(() => import('./TerminalView.vue'))

const props = withDefaults(
  defineProps<{
    node: LayoutNode
    tab: Tab
    path: number[]
    root?: boolean
    tabActive: boolean
    modKey: string
  }>(),
  { root: false, path: () => [] }
)
const emit = defineEmits<{ (e: 'cwd', p: { sessionId: string; path: string }): void }>()

const store = useSessions()
const { t } = useI18n()

const split = computed(() => {
  const n = props.node
  return n.kind === 'split' ? n : null
})
const pane = computed(() => {
  const n = props.node
  return n.kind === 'leaf' ? props.tab.panes.find((p) => p.id === n.paneId) : undefined
})
const grows = computed(() => (split.value ? childSizes(split.value) : []))

// ---- Side by side: what each pane says about itself ----
const multi = computed(() => props.tab.panes.length > 1)
const savedHost = computed(() => {
  const id = pane.value?.params.hostId
  return id ? store.hosts.find((h) => h.id === id) : undefined
})
const paneName = computed(() => {
  const p = pane.value
  if (!p) return ''
  return savedHost.value?.label ?? `${p.params.username}@${p.params.host}`
})
const paneEnv = computed(() => hostEnv(savedHost.value))
/** Round trip of this pane's own link (side by side, the status line only has the focused one). */
const paneMs = computed(() => {
  const p = pane.value
  return p?.status === 'connected' && p.sshSessionId ? store.latency[p.sshSessionId] : null
})

const isFocused = computed(
  () => props.tabActive && pane.value?.id === props.tab.activePaneId
)

/** A host-key rejection (first connect or a changed key): the pane needs a
 *  trust action, not a plain reconnect. */
const oldFingerprints = computed(() => {
  const pn = pane.value
  if (pn?.errorCode !== 'host_key_changed') return [] as string[]
  const host = pn.hostKeyHost ?? pn.params.host
  const port = pn.hostKeyPort ?? (pn.params.port || 22)
  // Same `|| 22` normalize as hostKeyKnown: a legacy / imported entry with a
  // falsy port must still match, or the "on record" row vanishes on a
  // host_key_changed card and the user only sees the new key.
  const entry = store.knownHosts.find(
    (k) => k.host === host && (k.port || 22) === (port || 22)
  )
  if (!entry) return []
  const fps = entry.fingerprints?.length ? entry.fingerprints : [entry.fingerprint]
  return fps.filter(Boolean)
})
const hostKeyRejected = computed(
  () =>
    pane.value?.errorCode === 'host_key_unknown' ||
    pane.value?.errorCode === 'host_key_changed'
)
/** The machine the failure card should name. A rejected key can belong to the
 *  jump hop, not the target — the fingerprint block already says so, and naming
 *  the target here would point at the wrong host exactly when the user has to
 *  decide whether to trust a key. */
const failHost = computed(
  () => (hostKeyRejected.value && pane.value?.hostKeyHost) || pane.value?.params.host || ''
)
const failPort = computed(
  () => (hostKeyRejected.value && pane.value?.hostKeyPort) || pane.value?.params.port || 22
)
const failUser = computed(
  () =>
    (hostKeyRejected.value && pane.value?.params.jump?.username) ||
    pane.value?.params.username ||
    ''
)

/** The trust write is in flight: keep the button disabled and say so. */
const trusting = computed(() => isTrustingPane(pane.value?.id ?? ''))

/** What this failure tells the user to go fix, offered beside the reconnect
 *  button. A broken hop points at the jump host's own profile when we know it. */
const paneActions = computed(() => {
  const pn = pane.value
  if (!pn) return [] as { action: ConnectAction; targetId?: string }[]
  const ctx = { hostId: pn.params.hostId, jumpHostId: pn.params.jumpHostId }
  return connectActions(pn.errorCode, ctx).map((action) => ({
    action,
    targetId: action.kind === 'fix-jump' ? ctx.jumpHostId ?? ctx.hostId : ctx.hostId
  }))
})

function onPaneAction(item: { action: ConnectAction; targetId?: string }): void {
  if (item.action.kind === 'security-settings') {
    store.toggleSettings(true, 'security')
    return
  }
  if (item.targetId) store.requestHostEditor(item.targetId)
}

function onDividerDown(e: PointerEvent, i: number): void {
  const el = splitEl.value
  if (!el || !split.value) return
  const rect = el.getBoundingClientRect()
  const span = split.value.dir === 'row' ? rect.width : rect.height
  if (span <= 0) return
  const sizes = childSizes(split.value)
  const pair = sizes[i] + sizes[i + 1]
  if (!pair) return
  const start = split.value.dir === 'row' ? e.clientX : e.clientY
  const startRatio = sizes[i] / pair
  const move = (ev: PointerEvent): void => {
    const p = split.value!.dir === 'row' ? ev.clientX : ev.clientY
    store.resizePane(props.tab.id, props.path, i, startRatio + (p - start) / span)
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    // Persist once on release — not on every move (would thrash settings.json).
    store.persistTabs()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const splitEl = ref<HTMLElement>()
</script>

<template>
  <!-- Leaf: a single pane cell -->
  <div
    v-if="node.kind === 'leaf' && pane"
    class="pane-cell pane-node"
    :class="{
      'pane-node-root': root,
      multi: tab.panes.length > 1,
      focused: tab.panes.length > 1 && isFocused
    }"
    :style="{ flexGrow: '1' }"
    @mousedown="store.setActivePane(tab.id, pane.id)"
  >
    <header v-if="multi" class="pane-head" :class="{ on: isFocused }">
      <div class="ph-main">
        <span class="ph-dot" :class="pane.status" />
        <h3 class="ph-name" :title="paneName">{{ paneName }}</h3>
        <span v-if="paneEnv?.prod" class="ph-prod">{{ paneEnv.label }}</span>
        <span v-if="paneMs" class="ph-ms">{{ paneMs }} ms</span>
      </div>
      <button
        class="ph-btn"
        :title="t('app.closePaneTip', { key: `${modKey}+Shift+W` })"
        :aria-label="t('app.closePaneTip', { key: `${modKey}+Shift+W` })"
        @mousedown.stop
        @click="store.closePane(pane.id)"
      >
        <Icon name="close" :size="14" />
      </button>
    </header>

    <div class="pane-term">
    <TerminalView
      v-if="pane.sshSessionId"
      :key="pane.sshSessionId"
      :session-id="pane.sshSessionId"
      :visible="tabActive"
      :focused="tabActive && pane.id === tab.activePaneId"
      :solid-cursor="multi"
      @cwd="emit('cwd', $event)"
    />

    <div v-else-if="pane.status === 'connecting'" class="state">
      <div class="spinner" />
      <p>{{ pane.reconnectAttempt ? pane.message : t('app.connecting', { title: tab.title }) }}</p>
    </div>

    <div v-else-if="pane.status === 'error'" class="idle">
      <div class="idle-card">
        <div class="idle-title">{{ paneName }}</div>
        <!-- Which machine failed. The "closed" card always showed this; the
             failure card did not, so two tabs with the same title were
             indistinguishable at exactly the moment it mattered. -->
        <div class="idle-sub" :title="`${failUser}@${failHost}:${failPort}`">
          {{ failUser }}@{{ failHost }}<template v-if="failPort !== 22">:{{ failPort }}</template>
        </div>
        <div class="idle-status" :class="{ warn: hostKeyRejected }">
          {{ hostKeyRejected ? (pane.errorCode === 'host_key_unknown' ? t('app.keyUntrusted') : t('app.keyChanged')) : t('app.connectFail') }}
        </div>
        <p class="idle-msg" :class="{ plain: hostKeyRejected }">{{ pane.message }}</p>
        <!-- The key being trusted, as ssh-keygen -lf prints it; for a changed
             key also the one on record, so there is something to check. -->
        <div v-if="hostKeyRejected && pane.hostKey" class="fp-block">
          <div class="fp-row">
            <span class="fp-label">{{ t('app.keyFpNow') }}</span>
            <code class="fp">{{ formatFingerprint(pane.hostKey) }}</code>
          </div>
          <div v-for="(fp, i) in oldFingerprints" :key="i" class="fp-row">
            <span class="fp-label">{{ t('app.keyFpOld') }}<template v-if="oldFingerprints.length > 1"> · {{ i + 1 }}</template></span>
            <code class="fp old">{{ formatFingerprint(fp) }}</code>
          </div>
        </div>
        <button
          class="idle-connect"
          :disabled="!!pane.reconnectAttempt || trusting"
          @click.stop="hostKeyRejected ? store.trustAndReconnect(pane.id) : store.reconnect(pane.id)"
        >
          <Icon name="refresh" :size="15" />
          <span>{{
            trusting
              ? t('app.trusting')
              : pane.reconnectAttempt
                ? t('app.reconnecting', { attempt: pane.reconnectAttempt })
                : hostKeyRejected
                  ? (pane.errorCode === 'host_key_unknown' ? t('app.trustKey') : t('app.trustReconnect'))
                  : t('app.reconnect')
          }}</span>
        </button>
        <button
          v-for="item in paneActions"
          :key="item.action.kind"
          class="idle-action"
          @click.stop="onPaneAction(item)"
        >
          {{ t(item.action.labelKey) }}
        </button>
        <button
          class="idle-close"
          @click.stop="tab.panes.length > 1 ? store.closePane(pane.id) : store.closeTab(tab.id)"
        >
          {{ tab.panes.length > 1 ? t('app.closePane') : t('app.closeTab') }}
        </button>
      </div>
    </div>

    <div v-else-if="pane.status === 'closed'" class="idle">
      <div class="idle-card">
        <div class="idle-icon"><Icon name="server" :size="24" /></div>
        <div class="idle-title">{{ paneName }}</div>
        <div class="idle-sub">
          {{ pane.params.username }}@{{ pane.params.host }}<template v-if="pane.params.port !== 22">:{{ pane.params.port }}</template>
        </div>
        <button class="idle-connect" @click.stop="store.reconnect(pane.id)">
          <Icon name="terminal" :size="15" /><span>{{ t('app.connect') }}</span>
        </button>
        <button
          class="idle-close"
          @click.stop="tab.panes.length > 1 ? store.closePane(pane.id) : store.closeTab(tab.id)"
        >
          {{ tab.panes.length > 1 ? t('app.closePane') : t('app.closeTab') }}
        </button>
      </div>
    </div>
    </div>

  </div>

  <!-- Branch: nested split container with a draggable divider between children -->
  <div
    v-else-if="split"
    ref="splitEl"
    class="pane-split pane-node"
    :class="[split.dir, { 'pane-node-root': root }]"
  >
    <!-- Key leaves by pane id: an index key makes Vue reuse the *component*
         after a non-last pane is closed, so the surviving xterm (buffer,
         scroll state, search box) gets patched onto a different session. -->
    <template
      v-for="(child, i) in split.children"
      :key="child.kind === 'leaf' ? `pane-${child.paneId}` : `split-${path.join('.')}-${i}`"
    >
      <PaneNode
        :node="child"
        :tab="tab"
        :path="[...path, i]"
        :tab-active="tabActive"
        :mod-key="modKey"
        :style="{ flexGrow: String(grows[i] ?? 1) }"
        @cwd="emit('cwd', $event)"
      />
      <div
        v-if="i < split.children.length - 1"
        class="pane-divider"
        :class="split.dir"
        @pointerdown.prevent="onDividerDown($event, i)"
      >
        <div class="pane-divider-grip" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pane-node {
  min-width: 0;
  min-height: 0;
  flex: 1 1 0;
}
.pane-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--console);
  overflow: hidden;
}
/* The terminal area. The terminal itself fills it; connecting / failed cards are
   positioned against it so they never sit under the head or the meta row. */
.pane-term {
  position: relative;
  flex: 1;
  min-height: 0;
}
.pane-term > :deep(.term-wrap) {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
}
/* The input target is told apart by a lifted head (not a bright border): the
   focused pane's head is --bg-elev-2, the others' stay on the console's own tone. */
.pane-cell.focused {
  z-index: 1;
}
/* Side by side (C3): a slim name strip per pane, one hairline between them; the
   pane that is not taking input dims instead of being boxed. */
.pane-head {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 4px 0 14px;
  font-family: var(--font-chrome);
  color: var(--text-faint);
  background: var(--console);
}
.pane-head.on {
  color: var(--text);
}
.ph-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ph-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
}
.ph-dot.connected {
  background: var(--ok);
}
.ph-dot.connecting {
  background: var(--warn);
}
.ph-dot.error {
  background: var(--danger);
}
.ph-name {
  margin: 0;
  font-size: 12.5px;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ph-prod {
  flex: none;
  font-size: 12px;
  color: var(--prod);
}
.ph-ms {
  flex: none;
  margin-left: 2px;
  font-size: 12px;
  color: var(--ok);
  font-variant-numeric: tabular-nums;
}
.ph-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--text-faint);
}
.ph-btn:hover {
  background: var(--selected);
  color: var(--text);
}
/* Recede every pane except the focused one so the active terminal stands out. */
.pane-cell.multi:not(.focused)::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  background: var(--scrim);
  pointer-events: none;
  transition: background 0.15s;
}
.pane-split {
  display: flex;
  background: var(--console);
}
/* Absolute-fill the stage. Declared after .pane-cell/.pane-split so it wins at
   equal specificity whether the root is a single leaf or a split branch. */
.pane-node-root {
  position: absolute;
  inset: 0;
}
.pane-split.row {
  flex-direction: row;
}
.pane-split.col {
  flex-direction: column;
}
.pane-divider {
  position: relative;
  flex: none;
  /* The one visible line between two panes (the container has no gap of its own). */
  background: var(--chrome-line);
  z-index: 2;
}
.pane-divider.row {
  width: 1px;
  cursor: col-resize;
}
.pane-divider.col {
  height: 1px;
  cursor: row-resize;
}
/* The visible line is 1px; hit-testing 1px exactly is miserable. An invisible
   ::before widens the grab area without moving the line. */
.pane-divider::before {
  content: '';
  position: absolute;
  inset: -5px;
}
.pane-divider.row::before {
  inset: 0 -5px;
}
.pane-divider.col::before {
  inset: -5px 0;
}
.pane-divider:hover .pane-divider-grip {
  opacity: 1;
}
.pane-divider-grip {
  position: absolute;
  inset: 0;
  margin: auto;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.12s;
}
.pane-divider.row .pane-divider-grip {
  width: 2px;
  height: 100%;
}
.pane-divider.col .pane-divider-grip {
  width: 100%;
  height: 2px;
}
.state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--text-dim);
}
.spinner {
  width: 26px;
  height: 26px;
  border: 2.5px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.idle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;
  background: var(--console);
}
.idle-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* min() against the pane (not the viewport) + auto margins: in a pane
     narrower than the card, flex centering clips the start edge — the
     reconnect button — and overflow:auto can't reach it. Auto margins keep
     the card centered when it fits and start-aligned (scrollable) when not. */
  width: min(300px, 100%);
  margin: auto;
}
.idle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--accent);
  margin-bottom: 16px;
}
.idle-title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
}
.idle-status {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.03em;
  color: var(--danger);
}
.idle-status.warn {
  color: var(--warn);
}
.idle-msg.plain {
  max-width: 320px;
  font-family: var(--font-ui);
  font-size: 12.5px;
  color: var(--text-dim);
}
.fp-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 340px;
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.fp-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
}
.fp-label {
  /* --text-faint is ~3.2:1 on the dark card, below WCAG AA — and this label
     sits next to the fingerprint the user must read before trusting a key. */
  font-size: 12px;
  color: var(--text-dim);
}
.fp {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text);
  word-break: break-all;
  user-select: text;
}
.fp.old {
  color: var(--text-dim);
  text-decoration: line-through;
}
.idle-msg {
  margin-top: 8px;
  max-width: 260px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-faint);
  text-align: center;
}
.idle-sub {
  margin-top: 5px;
  font-size: 12px;
  /* Same reason as .fp-label: this is the only line that tells two identically
     titled tabs apart, so it has to be readable. */
  color: var(--text-dim);
  font-family: var(--font-mono);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.idle-connect {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 70%;
  height: 42px;
  margin-top: 26px;
  border-radius: var(--radius);
  white-space: nowrap;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
  transition: border-color 0.15s, background 0.15s;
}
.idle-connect:hover {
  border-color: var(--accent);
  background: var(--bg-elev-2);
}
.idle-connect:disabled {
  opacity: 0.55;
  cursor: default;
  pointer-events: none;
}
/* The "go fix the cause" button: clearly tappable, but quieter than reconnect —
   reconnecting blindly is what the user was already doing wrong. */
.idle-action {
  margin-top: 14px;
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--accent);
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  transition: border-color 0.14s, background 0.14s;
}
.idle-action:hover {
  border-color: var(--accent);
  background: var(--bg-elev-2);
}
.idle-close {
  margin-top: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  color: var(--text-faint);
  border-radius: 6px;
  transition: color 0.14s;
}
.idle-close:hover {
  color: var(--text-dim);
}
</style>
