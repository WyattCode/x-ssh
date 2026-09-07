<script setup lang="ts">
import { reactive, ref, watch, nextTick, computed } from 'vue'
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import Icon from './Icon.vue'
import type { AuthMethod, ForwardMode, Host, ManagedKey } from '../../../shared/types'

const props = defineProps<{ open: boolean; host: Host | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const store = useSessions()
const { t } = useI18n()
const { toast } = useToast()
const { confirm } = useConfirm()

const uid = (): string =>
  `host-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const authLabels = computed<Record<AuthMethod, string>>(() => ({
  password: t('host.authPassword'),
  key: t('host.authKey'),
  agent: t('host.authAgent')
}))

interface ForwardRow {
  mode: ForwardMode
  localPort: number
  host: string
  remotePort: number
}

const form = reactive({
  id: uid(),
  label: '',
  host: '',
  port: 22,
  username: 'root',
  auth: 'password' as AuthMethod,
  keyPath: '' as string | undefined,
  group: '',
  jumpHostId: '',
  color: '',
  agentForward: false,
  onConnect: '',
  forwards: [] as ForwardRow[]
})
const password = ref('')
const passphrase = ref('')
const advanced = ref(false)
const labelEl = ref<HTMLInputElement>()

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const h = props.host
    Object.assign(form, {
      id: h?.id ?? uid(),
      label: h?.label ?? '',
      host: h?.host ?? '',
      port: h?.port ?? 22,
      username: h?.username ?? 'root',
      auth: h?.auth ?? 'password',
      keyPath: h?.keyPath ?? '',
      group: h?.group ?? '',
      jumpHostId: h?.jumpHostId ?? '',
      color: h?.color ?? '',
      agentForward: !!h?.agentForward,
      onConnect: h?.onConnect ?? '',
      forwards: (h?.portForwards ?? []).map((f) => ({
        mode: f.mode ?? 'local',
        localPort: f.localPort,
        host: f.remoteHost,
        remotePort: f.remotePort
      }))
    })
    password.value = ''
    passphrase.value = ''
    advanced.value = !!(h?.agentForward || h?.onConnect)
    nextTick(() => labelEl.value?.focus())
  }
)

const jumpCandidates = computed(() => store.hosts.filter((h) => h.id !== form.id))

const COLORS = [
  '#6ea8fe', '#51cf66', '#ffd43b', '#ff6b6b', '#da77f2', '#3bc9db',
  '#9c6ade', '#f783ac', '#ff922b', '#4dabf7', '#63e6be', '#fab005'
]

function addForward(): void {
  form.forwards.push({ mode: 'local', localPort: 0, host: '', remotePort: 0 })
}
function removeForward(i: number): void {
  form.forwards.splice(i, 1)
}

async function pickKey(): Promise<void> {
  const path = await window.api.pickKeyFile()
  if (path) form.keyPath = path
}

// ---- SSH key library ----
const managedKeys = ref<ManagedKey[]>([])
const keyModal = reactive({ open: false, name: '', type: 'ed25519', passphrase: '', error: '' })
async function loadKeys(): Promise<void> {
  managedKeys.value = await window.api.keys.list()
}
// Dropdown text identifies a key: friendly label + algorithm (and a short SHA
// fingerprint when present), so several keys aren't confused by name alone.
function keyOptionLabel(k: ManagedKey): string {
  let label = k.name
  if (k.type) label += ` (${k.type})`
  if (k.fingerprint) label += ` · ${k.fingerprint.replace(/^SHA256:/, '').slice(0, 12)}`
  return label
}
watch(
  () => props.open,
  (open) => {
    if (open) void loadKeys()
  },
  { immediate: true }
)
function useKey(path: string): void {
  form.keyPath = path
}
function openGenerate(): void {
  keyModal.open = true
  keyModal.name = ''
  keyModal.type = 'ed25519'
  keyModal.passphrase = ''
  keyModal.error = ''
}
async function generateKey(): Promise<void> {
  keyModal.error = ''
  const name = keyModal.name.trim()
  if (!name) {
    keyModal.error = t('host.keyNameReq')
    return
  }
  const r = await window.api.keys.generate({
    name,
    type: keyModal.type,
    passphrase: keyModal.passphrase || undefined
  })
  if (!r.ok || !r.key) {
    keyModal.error = r.error ?? t('host.keyGenFail')
    return
  }
  keyModal.open = false
  form.keyPath = r.key.path
  await loadKeys()
  if (r.key.passphraseProtected === false) toast(t('host.keyUnprotected'), 'info')
}
async function importKey(): Promise<void> {
  const r = await window.api.keys.import()
  if (r.canceled) return
  if (!r.ok || !r.key) {
    toast(r.error ?? t('host.keyImportFail'), 'error')
    return
  }
  form.keyPath = r.key.path
  await loadKeys()
  if (r.key.passphraseProtected === false) toast(t('host.keyUnprotected'), 'info')
}
async function deleteKey(k: ManagedKey): Promise<void> {
  const res = await confirm(t('host.keyDeleteConfirm', { name: k.name }))
  if (!res) return
  const r = await window.api.keys.del(k.id)
  if (r.ok) {
    if (form.keyPath === k.path) form.keyPath = ''
    await loadKeys()
  } else if (r.error) {
    toast(r.error, 'error')
  }
}

const canSave = (): boolean => !!form.host && !!form.username

async function save(): Promise<void> {
  if (!canSave()) return
  const forwards = form.forwards
    .filter((f) => f.mode === 'dynamic' ? f.localPort > 0 : f.localPort > 0 && f.remotePort > 0)
    .map((f) => ({ localPort: f.localPort, remoteHost: f.host.trim(), remotePort: f.remotePort, mode: f.mode }))
  const host: Host = {
    id: form.id,
    label: form.label.trim() || `${form.username}@${form.host}`,
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
    auth: form.auth,
    keyPath: form.auth === 'key' ? form.keyPath : undefined,
    group: form.group.trim() || undefined,
    jumpHostId: form.jumpHostId || undefined,
    color: form.color.trim() || undefined,
    agentForward: form.agentForward || undefined,
    onConnect: form.onConnect.trim() || undefined,
    portForwards: forwards.length ? forwards : undefined
  }
  // A typed password/passphrase is saved (encrypted); leaving it blank keeps any
  // previously saved secret untouched (empty → undefined, store won't overwrite).
  const pw = form.auth === 'password' && password.value ? password.value : undefined
  const pp = form.auth === 'key' && passphrase.value ? passphrase.value : undefined
  store.hosts = await window.api.hosts.save(host, pw, pp)
  emit('close')
}

/** Enter in any field saves — the password field especially, where finishing
 *  typing and hitting Enter is the natural end of the flow. Enter on a button
 *  keeps its native meaning (so Esc/取消/删除 still work as pressed), except
 *  with Ctrl/Cmd held, which saves from anywhere. */
function onEnter(e: KeyboardEvent): void {
  // The Enter that commits an IME candidate (typing 生产 into 名称) arrives here
  // too — that one belongs to the input method, not to us.
  if (e.isComposing || e.keyCode === 229) return
  const inField = (e.target as HTMLElement | null)?.tagName === 'INPUT'
  if (!inField && !(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  void save()
}

async function remove(): Promise<void> {
  if (!props.host) return
  store.hosts = await window.api.hosts.delete(props.host.id)
  emit('close')
}
</script>

<template>
  <div v-if="open" class="overlay" @mousedown.self="emit('close')">
    <div class="editor" @keydown.esc="emit('close')" @keydown.enter="onEnter">
      <div class="head">{{ host ? t('host.titleEdit') : t('host.titleNew') }}</div>

      <label class="field">
        <span>{{ t('host.name') }}</span>
        <input ref="labelEl" v-model="form.label" :placeholder="t('host.namePh')" />
      </label>

      <div class="grid">
        <label class="field grow">
          <span>{{ t('host.host') }}</span>
          <input v-model="form.host" :placeholder="t('host.hostPh')" spellcheck="false" />
        </label>
        <label class="field port">
          <span>{{ t('host.port') }}</span>
          <input v-model.number="form.port" type="number" min="1" max="65535" />
        </label>
      </div>

      <label class="field">
        <span>{{ t('host.username') }}</span>
        <input v-model="form.username" :placeholder="t('host.usernamePh')" spellcheck="false" />
      </label>

      <div class="grid">
        <label class="field grow">
          <span>{{ t('host.group') }}</span>
          <input v-model="form.group" :placeholder="t('host.groupPh')" spellcheck="false" />
        </label>
      </div>

      <div class="field">
        <span>{{ t('host.color') }}</span>
        <div class="color-row">
          <button
            class="swatch none"
            :class="{ on: !form.color }"
            :title="t('host.colorNone')"
            @click="form.color = ''"
          ></button>
          <button
            v-for="c in COLORS"
            :key="c"
            class="swatch"
            :class="{ on: form.color === c }"
            :style="{ background: c }"
            @click="form.color = c"
          ></button>
          <label class="swatch custom" :style="{ background: form.color || 'transparent' }">
            <input v-model="form.color" type="color" />
          </label>
        </div>
      </div>

      <div class="field">
        <span>{{ t('host.jump') }}</span>
        <div class="select-wrap">
          <select v-model="form.jumpHostId" class="select-in">
            <option value="">{{ t('host.jumpNone') }}</option>
            <option v-for="j in jumpCandidates" :key="j.id" :value="j.id">
              {{ j.label }} · {{ j.username }}@{{ j.host }}
            </option>
          </select>
          <Icon name="chevron-down" :size="15" class="select-caret" />
        </div>
        <p class="hint">{{ t('host.jumpHint') }}</p>
      </div>

      <div class="field">
        <span>{{ t('host.forwards') }} <button class="mini" @click="addForward">{{ t('set.gen.addForward') }}</button></span>
        <div v-for="(f, i) in form.forwards" :key="i" class="fw-row">
          <div class="select-wrap fw-mode">
            <select v-model="f.mode" class="select-in">
              <option value="local">{{ t('host.fwLocalMode') }}</option>
              <option value="remote">{{ t('host.fwRemoteMode') }}</option>
              <option value="dynamic">{{ t('host.fwDynamicMode') }}</option>
            </select>
            <Icon name="chevron-down" :size="13" class="select-caret" />
          </div>
          <input v-model.number="f.localPort" type="number" min="1" max="65535" :placeholder="t('host.fwListen')" />
          <input v-if="f.mode !== 'dynamic'" v-model="f.host" :placeholder="f.mode === 'remote' ? t('host.fwLocalTarget') : t('host.fwRemoteHost')" spellcheck="false" />
          <input v-if="f.mode !== 'dynamic'" v-model.number="f.remotePort" type="number" min="1" max="65535" :placeholder="t('host.fwTarget')" />
          <button class="mini danger" @click="removeForward(i)"><Icon name="close" :size="13" /></button>
        </div>
        <p v-if="!form.forwards.length" class="hint">{{ t('host.fwHint') }}</p>
      </div>

      <div class="field">
        <span>{{ t('host.auth') }}</span>
        <div class="seg">
          <button
            v-for="a in (['password', 'key', 'agent'] as AuthMethod[])"
            :key="a"
            :class="{ on: form.auth === a }"
            @click="form.auth = a"
          >
            {{ authLabels[a] }}
          </button>
        </div>
      </div>

      <button class="adv-toggle" type="button" @click="advanced = !advanced">
        <Icon name="chevron-right" :size="13" class="chev" :class="{ open: advanced }" />
        <span>{{ t('host.advanced') }}</span>
      </button>
      <template v-if="advanced">
        <div class="adv-body">
          <label class="field check">
            <input v-model="form.agentForward" type="checkbox" />
            <span class="check-label">{{ t('host.agentForward') }}</span>
          </label>

          <label class="field">
            <span>{{ t('host.onConnect') }}</span>
            <input v-model="form.onConnect" :placeholder="t('host.onConnectPh')" spellcheck="false" />
          </label>
        </div>
      </template>

      <label v-if="form.auth === 'password'" class="field">
        <span>{{ t('host.password') }}</span>
        <input
          v-model="password"
          type="password"
          :placeholder="host?.hasSavedPassword ? t('host.passwordSaved') : t('host.passwordAsk')"
        />
      </label>

      <template v-else-if="form.auth === 'key'">
        <div class="field">
          <span>{{ t('host.privateKey') }}</span>
          <div v-if="managedKeys.length" class="keyrow">
            <select class="keyselect" :value="form.keyPath || ''" @change="useKey(($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('host.noKey') }}</option>
              <option v-for="k in managedKeys" :key="k.id" :value="k.path">{{ keyOptionLabel(k) }}</option>
            </select>
            <button class="ghost" @click="openGenerate">{{ t('host.generateKey') }}</button>
            <button class="ghost" @click="importKey">{{ t('host.importKey') }}</button>
          </div>
          <div v-else class="keyrow">
            <input :value="form.keyPath" :placeholder="t('host.noKey')" readonly />
            <button class="ghost" @click="pickKey">{{ t('host.browse') }}</button>
            <button class="ghost" @click="openGenerate">{{ t('host.generateKey') }}</button>
            <button class="ghost" @click="importKey">{{ t('host.importKey') }}</button>
          </div>
        </div>
        <label class="field">
          <span>{{ t('host.passphrase') }}</span>
          <input
            v-model="passphrase"
            type="password"
            :placeholder="host?.hasSavedPassphrase ? t('host.passphraseSaved') : t('host.passphraseAsk')"
          />
        </label>
        <div v-if="managedKeys.length" class="keylist">
          <div v-for="k in managedKeys" :key="k.id" class="keyitem">
            <span class="keyname" :title="k.fingerprint">{{ k.name }}</span>
            <span v-if="k.type" class="keytype">{{ k.type }}</span>
            <button class="ghost del" :title="t('host.deleteKey')" @click="deleteKey(k)">{{ t('host.delete') }}</button>
          </div>
        </div>
      </template>

      <p v-else class="agent-note">{{ t('host.agentNote') }}</p>

      <div class="actions">
        <button v-if="host" class="danger" @click="remove">{{ t('host.delete') }}</button>
        <div class="spacer" />
        <button class="ghost" @click="emit('close')">{{ t('host.cancel') }}</button>
        <button class="primary" :disabled="!canSave()" @click="save">{{ t('host.save') }}</button>
      </div>

      <div v-if="keyModal.open" class="overlay key-modal" @mousedown.self="keyModal.open = false">
        <div class="editor keygen" @keydown.esc.stop="keyModal.open = false">
          <div class="head">{{ t('host.generateKey') }}</div>
          <label class="field">
            <span>{{ t('host.keyName') }}</span>
            <input v-model="keyModal.name" :placeholder="t('host.keyNamePh')" autofocus @keydown.enter.stop.prevent="generateKey" />
          </label>
          <div class="field">
            <span>{{ t('host.keyType') }}</span>
            <div class="authseg">
              <button v-for="ty in ['ed25519', 'rsa', 'ecdsa']" :key="ty" :class="{ on: keyModal.type === ty }" @click="keyModal.type = ty">{{ ty }}</button>
            </div>
          </div>
          <label class="field">
            <span>{{ t('host.passphrase') }}</span>
            <input v-model="keyModal.passphrase" type="password" :placeholder="t('host.passphraseAsk')" @keydown.enter.stop.prevent="generateKey" />
          </label>
          <p v-if="keyModal.error" class="err">{{ keyModal.error }}</p>
          <div class="actions">
            <div class="spacer" />
            <button class="ghost" @click="keyModal.open = false">{{ t('host.cancel') }}</button>
            <button class="primary" @click="generateKey">{{ t('host.save') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 10vh;
  z-index: 110;
}
.editor {
  width: min(460px, 92vw);
  max-height: 82vh;  overflow-y: auto;
  background-color: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 13px;
  animation: pop-in 0.16s cubic-bezier(0.2, 0.8, 0.3, 1);
}
.head {
  font-size: 15px;
  font-weight: 600;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field > span {
  font-size: 11.5px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.field input:not([type='checkbox']) {
  height: 34px;
  padding: 0 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  font-size: 13px;
}
.field input:not([type='checkbox']):focus {
  border-color: var(--accent);
}
/* Custom checkbox — the native control would render as a stark box on the
   dark surface; draw a small accent square with a white tick instead. */
.field input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  flex: none;
  margin: 0;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  transition: background 0.12s, border-color 0.12s;
}
.field input[type='checkbox']:hover {
  border-color: var(--text-dim);
}
.field input[type='checkbox']:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.field input[type='checkbox']:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.field input[type='checkbox']:checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 5px;
  height: 9px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.field.check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 9px;
}
.field.check .check-label {
  font-size: 13px;
  color: var(--text);
  text-transform: none;
  letter-spacing: 0;
}
/* Advanced options are tucked behind a disclosure so the default form stays
   minimal; the two add-ons (agent forwarding, startup command) only appear on
   demand. */
.adv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 3px 6px 3px 2px;
  font-size: 12px;
  color: var(--text-dim);
  border-radius: var(--radius-sm);
  transition: color 0.12s, background 0.12s, transform 0.15s;
}
.adv-toggle:hover {
  color: var(--text);
}
.adv-toggle .chev {
  transition: transform 0.16s ease;
}
.adv-toggle .chev.open {
  transform: rotate(90deg);
}
.adv-body {
  display: flex;
  flex-direction: column;
  gap: 13px;
}
/* Hide the native (light-colored) number spinner on the port field. */
.field input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}.field input[type='number']::-webkit-inner-spin-button,
.field input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.grid {
  display: flex;
  gap: 10px;
}
.grow {
  flex: 1;
}
.port {
  width: 84px;
}
.seg {
  display: flex;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 3px;
  gap: 3px;
}
.seg button {
  flex: 1;
  height: 28px;
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--text-dim);
  text-transform: capitalize;
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.keyrow {
  display: flex;
  gap: 8px;
}
.keyrow input {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.keyselect {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: var(--bg-2, #17191e);
  color: var(--text);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 6px 8px;
}
.keylist {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  max-height: 120px;
  overflow: auto;
}
.keyitem {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
}
.keyname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.keytype {
  color: var(--text-dim);
}
.keyitem .del {
  font-size: 11px;
  padding: 2px 6px;
}
.key-modal {
  align-items: center;
  backdrop-filter: blur(3px);
}
.keygen .field {
  margin-top: 8px;
}
.authseg {
  display: flex;
  gap: 6px;
}
.authseg button {
  flex: 1;
  padding: 6px 4px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.authseg button.on {
  border-color: var(--accent);
  color: var(--accent);
}
.err {
  color: var(--danger, #ff6b6b);
  font-size: 11px;
  margin: 4px 0;
}
.agent-note {
  font-size: 12px;
  color: var(--text-dim);
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.spacer {
  flex: 1;
}
button.ghost,
button.primary,
button.danger {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
}
button.ghost {
  color: var(--text-dim);
  border: 1px solid var(--border);
}
button.ghost:hover {
  background: var(--bg-elev-2);
}
button.primary {
  background: var(--accent);
  color: #fff;
  font-weight: 500;
}
button.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
button.danger {
  color: var(--danger);
  border: 1px solid transparent;
}
button.danger:hover {
  background: rgba(255, 107, 107, 0.12);
}
.hint {
  font-size: 11px;
  color: var(--text-faint);
  line-height: 1.4;
}
.select-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.select-in {
  width: 100%;
  height: 34px;
  padding: 0 32px 0 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.select-in:focus {
  border-color: var(--accent);
}
.select-caret {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-dim);
  pointer-events: none;
}
.mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--accent);
  background: var(--accent-soft);
}
.mini:hover {
  background: var(--accent);
  color: #fff;
}
.mini.danger {
  color: var(--danger);
  background: transparent;
}
.mini.danger:hover {
  background: rgba(255, 107, 107, 0.12);
}
.fw-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.fw-row .fw-mode {
  flex: none;
  width: 100px;
}
.fw-row .fw-mode .select-in {
  height: 30px;
}
.fw-row input {
  min-width: 0;
  height: 30px;
}
.fw-row input[type='number'] {
  width: 84px;
  flex: none;
}
.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.color-row .swatch {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
  position: relative;
}
.color-row .swatch.on {
  border-color: var(--text);
}
.color-row .swatch.none {
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-faint);
}
.color-row .swatch.none::after {
  content: '×';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
.color-row .swatch.custom {
  width: 26px;
  height: 26px;
  overflow: hidden;
}
.color-row .swatch.custom input {
  position: absolute;
  inset: -4px;
  width: 34px;
  height: 34px;
  opacity: 0;
  cursor: pointer;
}
</style>
