<script setup lang="ts">
import { nextTick, reactive, computed, ref, watch } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'

const dialogEl = ref<HTMLElement>()
useFocusTrap(dialogEl, () => store.forwardOpen)
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { useConfirm } from '../composables/confirm'
import { isImeKey } from '../lib/ime'
import { useToast } from '../composables/toast'
import type { ForwardMode } from '../../../shared/types'
import Icon from './Icon.vue'

const store = useSessions()
const { t } = useI18n()
const { confirm } = useConfirm()
const { toast } = useToast()
// Mounted for the app's lifetime and shown by its own v-if, so an onMounted
// focus ran once at startup with no element and never again.
watch(
  () => store.forwardOpen,
  (open) => {
    if (open) nextTick(() => dialogEl.value?.focus())
  }
)

const list = computed(() => store.activePane?.params.portForwards ?? [])
const modeLabel = (m?: ForwardMode): string =>
  (m ?? 'local') === 'local'
    ? t('status.fwLocal')
    : (m ?? 'local') === 'remote'
      ? t('status.fwRemote')
      : t('status.fwDynamic')

const form = reactive({ mode: 'local' as ForwardMode, localPort: '', host: '', remotePort: '' })
const busy = ref(false)
const removing = ref(false)
const err = ref('')

// Switching local/remote/dynamic changes which fields are validated, so a
// "bad port" from the previous mode is stale — drop it.
watch(
  () => form.mode,
  () => {
    err.value = ''
  }
)

function ruleText(m: ForwardMode, lp: number, host: string, rp: number): string {
  if (m === 'dynamic') return `SOCKS 127.0.0.1:${lp}`
  return `${lp} → ${host || '127.0.0.1'}:${rp}`
}

async function add(): Promise<void> {
  const lp = Number(form.localPort)
  const rp = Number(form.remotePort)
  if (!Number.isInteger(lp) || lp < 1 || lp > 65535) {
    err.value = t('fw.badPort')
    return
  }
  if (form.mode !== 'dynamic' && (!Number.isInteger(rp) || rp < 1 || rp > 65535)) {
    err.value = t('fw.badPort')
    return
  }
  err.value = ''
  if (busy.value) return
  busy.value = true
  try {
    const r = await store.addForward({
      mode: form.mode,
      localPort: lp,
      remoteHost: form.host.trim() || '127.0.0.1',
      remotePort: form.mode === 'dynamic' ? 0 : rp
    })
    if (!r.ok) err.value = r.error ?? t('fw.fail')
    else {
      form.localPort = ''
      form.remotePort = ''
    }
  } finally {
    busy.value = false
  }
}

// Enter in any of the form's text fields adds the rule, like the forwards page.
// Bound plainly (no `.prevent`) so an IME candidate key is never cancelled.
function submitOnEnter(e: KeyboardEvent): void {
  if (isImeKey(e)) return
  e.preventDefault()
  if (busy.value) return
  void add()
}

async function remove(mode: ForwardMode | undefined, localPort: number): Promise<void> {
  if (removing.value) return
  // Same destructive action as the forwards page, which confirms first.
  const rule = list.value.find((f) => f.mode === mode && f.localPort === localPort)
  const label = rule ? ruleText(rule.mode ?? 'local', rule.localPort, rule.remoteHost, rule.remotePort) : ''
  if (!(await confirm(t('fwp.removeConfirm', { rule: label }), { danger: true, confirmText: t('fw.remove') }))) return
  removing.value = true
  try {
    await store.removeForward(mode, localPort)
  } finally {
    removing.value = false
  }
  // Await the result: a failed stop used to leave the rule in the list with no
  // error at all (the page already awaits + toasts; this dialog did not).
  const r = await store.removeForward(mode, localPort)
  if (!r.ok) toast(r.error ?? t('fw.removeFail'), 'error')
}
</script>

<template>
  <div v-if="store.forwardOpen" class="fw-overlay" @mousedown.self="store.toggleForwards(false)">
    <div ref="dialogEl" tabindex="-1" class="fw-dialog" @keydown.esc="store.toggleForwards(false)">
      <div class="fw-head">
        <Icon name="split" :size="15" />
        <span class="fw-title">{{ t('fw.title') }}</span>
        <button class="fw-x" :title="t('fileDiff.close')" @click="store.toggleForwards(false)"><Icon name="close" :size="14" /></button>
      </div>
      <div class="fw-body">
        <p v-if="!list.length" class="fw-empty">{{ t('fw.empty') }}</p>
        <div v-for="(f, i) in list" :key="i" class="fw-row">
          <span class="fw-mode">{{ modeLabel(f.mode) }}</span>
          <span class="fw-rule">{{ ruleText(f.mode ?? 'local', f.localPort!, f.remoteHost || '127.0.0.1', f.remotePort!) }}</span>
          <button class="fw-del" :title="t('fw.remove')" :disabled="removing" @click="void remove(f.mode, f.localPort!)"><Icon name="close" :size="13" /></button>
        </div>
        <div class="fw-form">
          <select v-model="form.mode" class="fw-in">
            <option value="local">{{ t('status.fwLocal') }}</option>
            <option value="remote">{{ t('status.fwRemote') }}</option>
            <option value="dynamic">{{ t('status.fwDynamic') }}</option>
          </select>
          <input v-model="form.localPort" class="fw-in" :placeholder="t('fw.localPort')" spellcheck="false" @keydown.enter="submitOnEnter" />
          <input v-if="form.mode !== 'dynamic'" v-model="form.host" class="fw-in grow" :placeholder="t('fw.remoteHost')" spellcheck="false" @keydown.enter="submitOnEnter" />
          <input v-if="form.mode !== 'dynamic'" v-model="form.remotePort" class="fw-in" :placeholder="t('fw.remotePort')" spellcheck="false" @keydown.enter="submitOnEnter" />
          <button class="fw-add" :disabled="busy" @click="add">{{ t('fw.add') }}</button>
        </div>
        <p v-if="err" class="fw-err">{{ err }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fw-overlay {
  position: fixed;
  inset: 0;
  z-index: 118;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.fw-dialog {
  width: min(460px, 92vw);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.fw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.fw-title {
  font-weight: 600;
  font-size: 13px;
}
.fw-x {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
}
.fw-x:hover {
  color: var(--text);
}
.fw-body {
  padding: 12px 14px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fw-empty {
  color: var(--text-faint);
  font-size: 12px;
  margin: 4px 0;
}
.fw-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.fw-mode {
  flex: none;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 999px;
}
.fw-rule {
  flex: 1;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text-dim);
}
.fw-del {
  flex: none;
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
}
.fw-del:hover {
  color: var(--danger);
}
.fw-form {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.fw-in {
  flex: 0 1 auto;
  min-width: 0;
  padding: 6px 8px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}
.fw-in.grow {
  flex: 1 1 auto;
}
.fw-add {
  flex: none;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 12px;
  cursor: pointer;
}
.fw-add:disabled {
  opacity: 0.5;
}
.fw-del:disabled {
  opacity: 0.5;
  cursor: default;
}
.fw-err {
  color: var(--danger);
  font-size: 11.5px;
  margin: 0;
}
</style>
