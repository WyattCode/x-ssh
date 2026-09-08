<script setup lang="ts">
import { computed, ref, defineAsyncComponent } from 'vue'
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { childSizes } from '../lib/paneLayout'
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

const isFocused = computed(
  () => props.tabActive && pane.value?.id === props.tab.activePaneId
)

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
    <button
      v-if="tab.panes.length > 1"
      class="pane-x"
      :title="t('app.closePaneTip', { key: `${modKey}+Shift+W` })"
      @mousedown.stop
      @click="store.closePane(pane.id)"
    >
      <Icon name="close" :size="13" />
    </button>

    <TerminalView
      v-if="pane.sshSessionId"
      :session-id="pane.sshSessionId"
      :visible="tabActive"
      :focused="tabActive && pane.id === tab.activePaneId"
      @cwd="emit('cwd', $event)"
    />

    <div v-else-if="pane.status === 'connecting'" class="state">
      <div class="spinner" />
      <p>{{ pane.reconnectAttempt ? pane.message : t('app.connecting', { title: tab.title }) }}</p>
    </div>

    <div v-else-if="pane.status === 'error'" class="idle">
      <div class="idle-card">
        <div class="idle-title">{{ tab.title }}</div>
        <div class="idle-status" :class="{ warn: pane.errorCode === 'host_key_changed' }">
          {{ pane.errorCode === 'host_key_changed' ? t('app.keyChanged') : t('app.connectFail') }}
        </div>
        <p class="idle-msg">{{ pane.message }}</p>
        <button
          class="idle-connect"
          @click.stop="
            pane.errorCode === 'host_key_changed'
              ? store.trustAndReconnect(pane.id)
              : store.reconnect(pane.id)
          "
        >
          <Icon name="refresh" :size="15" />
          <span>{{ pane.errorCode === 'host_key_changed' ? t('app.trustReconnect') : t('app.reconnect') }}</span>
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
        <div class="idle-title">{{ tab.title }}</div>
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

  <!-- Branch: nested split container with a draggable divider between children -->
  <div
    v-else-if="split"
    ref="splitEl"
    class="pane-split pane-node"
    :class="[split.dir, { 'pane-node-root': root }]"
  >
    <template v-for="(child, i) in split.children" :key="`${path.join('.')}-${i}`">
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
.pane-node-root {
  position: absolute;
  inset: 0;
}
.pane-cell {
  position: relative;
  background: var(--bg);
  overflow: hidden;
}
.pane-cell.focused {
  box-shadow: inset 0 0 0 1.5px var(--accent);
  z-index: 1;
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
  gap: 1px;
  background: var(--border);
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
  background: transparent;
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
.pane-x {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: var(--text-faint);
  background: var(--bg-elev);
  border: none;
  cursor: pointer;
}
.pane-x:hover {
  color: var(--text);
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: 100%;
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
  background: var(--bg);
}
.idle-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(300px, 86vw);
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
  color: var(--text-faint);
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
