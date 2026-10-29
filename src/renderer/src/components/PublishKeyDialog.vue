<script setup lang="ts">
import { nextTick, ref, reactive, computed, watch } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'

const dialogEl = ref<HTMLElement>()
useFocusTrap(dialogEl, () => store.publishOpen)
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { keyErrorMessage } from '../lib/keyError'
import type { ManagedKey, Host } from '../../../shared/types'
import Icon from './Icon.vue'

const store = useSessions()
const { t } = useI18n()
// Mounted for the app's lifetime and shown by its own v-if, so an onMounted
// focus ran once at startup with no element and never again.
watch(
  () => store.publishOpen,
  (open) => {
    if (open) nextTick(() => dialogEl.value?.focus())
  }
)

const keys = ref<ManagedKey[]>([])
const keyId = ref('')
const selected = reactive(new Set<string>())
const busy = ref(false)
const revokeBusy = ref(false)
const err = ref('')
const results = ref<{ host: string; ok: boolean; error?: string }[]>([])
const revokeResults = ref<{ host: string; ok: boolean; error?: string }[]>([])

const hostList = computed(() => [...store.hosts].sort((a, b) => a.label.localeCompare(b.label)))

async function refresh(): Promise<void> {
  keys.value = await window.api.keys.list()
  if (!keys.value.some((k) => k.id === keyId.value)) keyId.value = keys.value[0]?.id ?? ''
}
function toggleHost(h: Host): void {
  if (selected.has(h.id)) selected.delete(h.id)
  else selected.add(h.id)
}

async function publish(): Promise<void> {
  if (!keyId.value || !selected.size) return
  busy.value = true
  err.value = ''
  results.value = []
  const r = await window.api.keys.publish(keyId.value, [...selected])
  busy.value = false
  if (!r.ok) {
    err.value = r.code || r.error ? keyErrorMessage(r, t) : t('keyPub.fail')
    return
  }
  results.value = r.results ?? []
}
async function revoke(): Promise<void> {
  if (!keyId.value || !selected.size) return
  revokeBusy.value = true
  revokeResults.value = []
  const r = await window.api.keys.revoke(keyId.value, [...selected])
  revokeBusy.value = false
  if (!r.ok) {
    err.value = r.code || r.error ? keyErrorMessage(r, t) : t('keyPub.revokeFail')
    return
  }
  revokeResults.value = r.results ?? []
}

watch(
  () => store.publishOpen,
  async (open) => {
    if (!open) return
    results.value = []
    revokeResults.value = []
    err.value = ''
    selected.clear()
    await refresh()
  }
)
</script>

<template>
  <div v-if="store.publishOpen" class="kp-overlay" @mousedown.self="store.togglePublish(false)">
    <div ref="dialogEl" tabindex="-1" class="kp-dialog" @keydown.esc="store.togglePublish(false)">
      <div class="kp-head">
        <Icon name="keyboard" :size="15" />
        <span class="kp-title">{{ t('keyPub.title') }}</span>
        <button class="kp-x" :title="t('fileDiff.close')" @click="store.togglePublish(false)"><Icon name="close" :size="14" /></button>
      </div>
      <div class="kp-body">
        <label class="kp-label">{{ t('keyPub.key') }}</label>
        <select v-model="keyId" class="kp-select">
          <option v-for="k in keys" :key="k.id" :value="k.id">{{ k.name }}<template v-if="k.type"> · {{ k.type }}</template></option>
        </select>
        <label class="kp-label">{{ t('keyPub.hosts') }}</label>
        <div class="kp-hosts">
          <label v-for="h in hostList" :key="h.id" class="kp-host">
            <input type="checkbox" :checked="selected.has(h.id)" @change="toggleHost(h)" />
            <span class="kp-host-label">{{ h.label }}</span>
            <span class="kp-host-sub">{{ h.username }}@{{ h.host }}<template v-if="h.port !== 22">:{{ h.port }}</template></span>
          </label>
          <p v-if="!hostList.length" class="kp-empty">{{ t('keyPub.noHosts') }}</p>
        </div>
        <div class="kp-actions">
          <button class="kp-run" :disabled="busy || !keyId || !selected.size" @click="publish">
            <Icon name="send" :size="14" />{{ t('keyPub.publish') }}
          </button>
          <button class="kp-run ghost" :disabled="revokeBusy || !keyId || !selected.size" @click="revoke">
            <Icon name="trash" :size="14" />{{ t('keyPub.revoke') }}
          </button>
        </div>
        <p v-if="err" class="kp-err">{{ err }}</p>
        <div v-if="results.length" class="kp-results">
          <div class="kp-results-h">{{ t('keyPub.published') }}</div>
          <div v-for="(r, i) in results" :key="i" class="kp-result" :class="r.ok ? 'ok' : 'bad'">
            <Icon :name="r.ok ? 'check' : 'alert-triangle'" :size="13" />
            <span class="kp-host-label">{{ r.host }}</span>
            <span v-if="!r.ok" class="kp-err">{{ r.error }}</span>
          </div>
        </div>
        <div v-if="revokeResults.length" class="kp-results">
          <div class="kp-results-h">{{ t('keyPub.revoked') }}</div>
          <div v-for="(r, i) in revokeResults" :key="i" class="kp-result" :class="r.ok ? 'ok' : 'bad'">
            <Icon :name="r.ok ? 'check' : 'alert-triangle'" :size="13" />
            <span class="kp-host-label">{{ r.host }}</span>
            <span v-if="!r.ok" class="kp-err">{{ r.error }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kp-overlay {
  position: fixed;
  inset: 0;
  z-index: 118;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.kp-dialog {
  width: min(440px, 92vw);
  max-height: 74vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.kp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.kp-title {
  font-weight: 600;
  font-size: 13px;
}
.kp-x {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
}
.kp-x:hover {
  color: var(--text);
}
.kp-body {
  padding: 12px 14px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kp-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
}
.kp-select {
  padding: 7px 9px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
}
.kp-hosts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow: auto;
}
.kp-host {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.kp-host:hover {
  background: var(--bg-elev-2);
}
.kp-host input {
  accent-color: var(--accent);
}
.kp-host-label {
  flex: 0 1 auto;
  font-size: 12.5px;
  color: var(--text);
}
.kp-host-sub {
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  color: var(--text-faint);
}
.kp-empty {
  color: var(--text-faint);
  font-size: 12px;
}
.kp-run {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 14px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 13px;
  cursor: pointer;
}
.kp-actions {
  display: flex;
  gap: 8px;
}
.kp-run:disabled {
  opacity: 0.5;
  cursor: default;
}
.kp-run.ghost {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text);
}
.kp-results-h {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
  margin-top: 4px;
}
.kp-err {
  color: var(--danger);
  font-size: 11.5px;
  margin: 0;
}
.kp-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kp-result {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 12px;
}
.kp-result.ok {
  color: var(--ok);
}
.kp-result.bad {
  color: var(--danger);
}
</style>
