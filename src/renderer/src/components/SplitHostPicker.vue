<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { hostEnv } from '../lib/hostEnv'
import { useFocusTrap } from '../composables/focusTrap'
import type { Host } from '../../../shared/types'

/** Pick a saved host to put beside the current terminal (the side-by-side view).
 *  A small popover anchored under the button that opened it. */
const props = defineProps<{ open: boolean; x: number; y: number }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useSessions()
const { t } = useI18n()
const { toast } = useToast()

const query = ref('')
const searchEl = ref<HTMLInputElement>()
const panelEl = ref<HTMLElement>()
useFocusTrap(panelEl, () => props.open)
const pos = ref({ x: 0, y: 0 })
const busy = ref(false)

/** Hosts the active tab is not already showing. */
const choices = computed(() => {
  const tab = store.active
  const inTab = new Set((tab?.panes ?? []).map((p) => p.params.hostId).filter(Boolean))
  const q = query.value.trim().toLowerCase()
  return store.hosts
    .filter((h) => !inTab.has(h.id))
    .filter((h) => !q || `${h.label} ${h.username}@${h.host} ${h.group ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
})

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    query.value = ''
    pos.value = { x: props.x, y: props.y }
    await nextTick()
    const r = panelEl.value?.getBoundingClientRect()
    if (r) {
      pos.value = {
        x: Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8)),
        y: Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8))
      }
    }
    searchEl.value?.focus()
  }
)

async function pick(h: Host): Promise<void> {
  const tab = store.active
  if (!tab || busy.value) return
  busy.value = true
  emit('close')
  try {
    const r = await store.splitWithHost(tab.id, h)
    if (r === 'needs-password') toast(t('cmp.needsPassword', { name: h.label }), 'error')
    else if (r === 'unavailable') toast(t('cmp.unavailable'), 'error')
  } finally {
    busy.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'Enter' && choices.value.length === 1) {
    e.preventDefault()
    void pick(choices.value[0])
  }
}
</script>

<template>
  <div v-if="open" class="picker-overlay" @mousedown="emit('close')" @contextmenu.prevent="emit('close')">
    <div
      ref="panelEl"
      class="picker"
      role="dialog"
      :aria-label="t('cmp.pickTitle')"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @mousedown.stop
      @keydown="onKey"
    >
      <div class="picker-title">{{ t('cmp.pickTitle') }}</div>
      <input
        ref="searchEl"
        v-model="query"
        class="picker-search"
        :placeholder="t('hosts.search')"
        spellcheck="false"
        autocomplete="off"
      />
      <div class="picker-list">
        <button v-for="h in choices" :key="h.id" class="picker-row" @click="pick(h)">
          <span class="pr-main">
            <span class="pr-name">{{ h.label }}</span>
            <span class="pr-addr">{{ h.username }}@{{ h.host }}<template v-if="h.port !== 22">:{{ h.port }}</template></span>
          </span>
          <span v-if="hostEnv(h)" class="env-tag" :class="{ prod: hostEnv(h)?.prod }">{{ hostEnv(h)?.label }}</span>
        </button>
        <p v-if="!choices.length" class="picker-empty">{{ t('cmp.noHosts') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
}
.picker {
  position: fixed;
  width: 300px;
  max-height: min(420px, 70vh);
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-menu);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.picker-title {
  padding: 12px 14px 4px;
  font-size: 11.5px;
  color: var(--text-dim);
}
.picker-search {
  margin: 6px 10px 8px;
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.picker-search:focus {
  border-color: var(--accent);
}
.picker-list {
  overflow-y: auto;
  padding: 0 6px 8px;
}
.picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  text-align: left;
}
.picker-row:hover,
.picker-row:focus-visible {
  background: var(--selected);
}
.pr-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.pr-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pr-addr {
  font: 11px var(--font-mono);
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.picker-empty {
  padding: 16px 12px;
  font-size: 12.5px;
  color: var(--text-faint);
  text-align: center;
}
</style>
