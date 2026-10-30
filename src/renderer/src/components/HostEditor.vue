<script setup lang="ts">
import { reactive, ref, watch, nextTick, computed } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'

import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import { useConfirm } from '../composables/confirm'
import { isImeKey } from '../lib/ime'
import { keyErrorMessage } from '../lib/keyError'
import { jumpSelectBlocked, jumpSelectOptions, jumpUsedBy } from '../lib/jumpCandidates'
import Icon from './Icon.vue'
import OsIcon from './OsIcon.vue'
import { PRESETS } from '../lib/terminalThemes'
import type { AuthMethod, ForwardMode, Host, ManagedKey } from '../../../shared/types'

const props = defineProps<{ open: boolean; host: Host | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const store = useSessions()
const { t } = useI18n()
const { toast } = useToast()
const { confirm } = useConfirm()

/** Maps a key-operation error code from main to a localized message. */
function keyOpError(err?: string): string {
  if (err === 'invalid-private-key') return t('host.invalidPrivateKey')
  if (err === 'illegal-key-id') return t('host.illegalKeyId')
  return err ?? t('host.keyImportFail')
}

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
  tags: [] as string[],
  jumpHostId: '',
  color: '',
  terminalTheme: '',
  terminalFontFamily: '',
  agentForward: false,
  onConnect: '',
  onConnectDelayMs: 0,
  proxyOn: false,
  proxyHost: '',
  proxyPort: 1080,
  proxyType: 'socks5' as 'socks5' | 'http',
  proxyUser: '',
  proxyPass: '',
  forwards: [] as ForwardRow[]
})
const password = ref('')
const passphrase = ref('')
/** Guards against a second save (Enter / Save) while hosts.save is in flight. */
const saving = ref(false)
/** Which 更多选项 rows are open (each opens in place under its row). */
const sections = reactive({ keys: false, proxy: false, forwards: false, onConnect: false, appearance: false })
const labelEl = ref<HTMLInputElement>()
const panelEl = ref<HTMLElement>()
useFocusTrap(panelEl, () => props.open)
const tagInputEl = ref<HTMLInputElement>()
const keyNameEl = ref<HTMLInputElement>()
function closeKeySheet(): void {
  // A generate in flight owns the sheet: dismissing it would let the late
  // result close a sheet the user already left (or set a keyPath unseen).
  if (keyModal.busy) return
  keyModal.open = false
  nextTick(() => panelEl.value?.focus())
}

/** JSON of the fields a save would write — the baseline for the unsaved-changes
 *  check below. `password`/`passphrase` are included because typing one and
 *  closing without saving loses it too. */
function formSnapshot(): string {
  return JSON.stringify({
    f: form,
    password: password.value,
    passphrase: passphrase.value
  })
}
let cleanSnapshot = ''
// Closing (Esc / X / backdrop) with edits must not silently discard them —
// the in-app text editor already asks, and losing a typed password or a
// half-filled forward here is the same kind of loss.
async function requestClose(): Promise<void> {
  if (keyModal.open) {
    closeKeySheet()
    return
  }
  if (formSnapshot() !== cleanSnapshot) {
    const ok = await confirm(t('host.discardConfirm'), { danger: true, confirmText: t('host.discard') })
    if (!ok) return
  }
  emit('close')
}

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
      tags: [...(h?.tags ?? [])],
      jumpHostId: h?.jumpHostId ?? '',
      color: h?.color ?? '',
      terminalTheme: h?.terminalTheme ?? '',
      terminalFontFamily: h?.terminalFontFamily ?? '',
      agentForward: !!h?.agentForward,
      onConnect: h?.onConnect ?? '',
      onConnectDelayMs: h?.onConnectDelayMs ?? 0,
      proxyOn: !!h?.proxy,
      proxyHost: h?.proxy?.host ?? '',
      proxyPort: h?.proxy?.port ?? 1080,
      proxyType: h?.proxy?.type ?? 'socks5',
      proxyUser: h?.proxy?.username ?? '',
      proxyPass: h?.proxy?.password ?? '',
      forwards: (h?.portForwards ?? []).map((f) => ({
        mode: f.mode ?? 'local',
        localPort: f.localPort,
        host: f.remoteHost,
        remotePort: f.remotePort
      }))
    })
    password.value = ''
    passphrase.value = ''
    Object.assign(sections, { keys: false, proxy: false, forwards: false, onConnect: false, appearance: false })
    nextTick(() => labelEl.value?.focus())
    // Baseline for the unsaved-changes guard: capture after the form is
    // filled and focus moved (some fields normalize on blur).
    nextTick(() => {
      cleanSnapshot = formSnapshot()
    })
  }
)

// One hop only, like Android: a jump host must not jump itself, and a host that
// others already tunnel through may not start a nest of its own (its existing
// jump can still be cleared).
const jumpOptions = computed(() => jumpSelectOptions(store.hosts, form.id || undefined, form.jumpHostId))
const jumpBlocked = computed(() => jumpSelectBlocked(store.hosts, form.id || undefined, form.jumpHostId))
const jumpBlockerLabel = computed(() => jumpUsedBy(store.hosts, form.id || undefined)[0]?.label ?? '')
const jumpCandidates = computed(() => store.hosts.filter((h) => h.id !== form.id))
const jumpGone = computed(
  () => !!form.jumpHostId && !store.hosts.some((h) => h.id === form.jumpHostId)
)
/** Hosts that use *this* profile as their jump — one hop only, same as Android. */
const jumpUsedBy = computed(() =>
  props.host ? store.hosts.filter((h) => h.jumpHostId === props.host!.id) : []
)
// Match Android JumpField: only block *adding* a jump when this host is
// already someone else's hop (one hop only). A stale/legacy jumpHostId must
// still be clearable.
const jumpBlocked = computed(() => jumpUsedBy.value.length > 0 && !form.jumpHostId)
// One hop only (same rule as Android): a host that itself uses a jump can't be
// picked, because core ignores the second hop and the connect then looks like a
// mysterious network failure.
const jumpCandidates = computed(() => store.hosts.filter((h) => h.id !== form.id && !h.jumpHostId))
// A selection saved before that filter existed can still point at a nested hop;
// warn about it (the select stays usable so the user can clear it).
const jumpNested = computed(
  () => !!form.jumpHostId && store.hosts.some((h) => h.id === form.jumpHostId && !!h.jumpHostId)
)

// Pasting "user@host:port" into 主机 fills all three. Only on an unambiguous
// shape: a single colon (so IPv6 literals are left alone).
// "user@host:port" in the host field is split into its three fields — on paste,
// on leaving the field and before saving, never per keystroke (typing
// "host:2222" digit by digit must not turn into host "host222" port 2).
function splitHostInput(): void {
  const m = /^\s*(?:([^@\s:]+)@)?([^@\s:]+)(?::(\d{1,5}))?\s*$/.exec(form.host)
  if (!m || (!m[1] && !m[3])) return
  const port = m[3] ? Number(m[3]) : 0
  if (m[3] && (port < 1 || port > 65535)) return
  form.host = m[2]
  if (m[1]) form.username = m[1]
  if (port) form.port = port
}
function onHostPaste(): void {
  // The pasted text lands in the model on the next input event.
  setTimeout(splitHostInput)
}

// One-line summaries shown on the closed 更多选项 rows.
const proxySummary = computed(() =>
  form.proxyOn && form.proxyHost.trim()
    ? `${form.proxyType === 'http' ? 'HTTP' : 'SOCKS5'} ${form.proxyHost.trim()}:${form.proxyPort || ''}`
    : t('host.none')
)
const onConnectSummary = computed(
  () => form.onConnect.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? t('host.none')
)
const appearanceSummary = computed(() => {
  const theme = PRESETS.find((p) => p.id === form.terminalTheme)?.label ?? t('host.termThemeSystem')
  const font = form.terminalFontFamily.trim()
  return font ? `${theme} · ${font}` : theme
})

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
/** Guards generate/import: a double Enter or double click used to spawn two keypairs. */
const keyBusy = ref(false)
/** The key list could not be read: show a retry instead of the "browse"
 *  button, which would look like "you have no keys". */
const keysFailed = ref(false)
const labelsWarned = ref(false)
const keyModal = reactive({ open: false, name: '', type: 'ed25519', passphrase: '', error: '' })
// The generate-key sheet is a modal of its own inside the panel: without its
// own trap, Tab walked out of the sheet into the host form behind it.
const keySheetEl = ref<HTMLElement>()
useFocusTrap(keySheetEl, () => keyModal.open)
const keyModal = reactive({ open: false, name: '', type: 'ed25519', passphrase: '', error: '', busy: false })
// In-flight guards: a double-clicked import opened two OS dialogs, and a
// double-clicked trash stacked two confirms / two deletes.
const importing = ref(false)
const deletingId = ref<string | null>(null)
async function loadKeys(): Promise<void> {
  try {
    managedKeys.value = await window.api.keys.list()
    keysFailed.value = false
  } catch {
    managedKeys.value = []
    keysFailed.value = true
    toast(t('host.keyListFail'), 'error')
  } catch {
    toast(t('host.keyListFail'), 'error')
    return
  }
  try {
    const st = await window.api.keys.labelsStatus()
    if (st.loadFailed && !labelsWarned.value) {
      labelsWarned.value = true
      toast(t('host.keyLabelsLoadFail'), 'error')
    }
  } catch {
    /* status is best-effort */
  }
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
    if (open) {
      labelsWarned.value = false
      void loadKeys()
    }
  },
  { immediate: true }
)
function useKey(path: string): void {
  form.keyPath = path
}
function openGenerate(): void {
  nextTick(() => keyNameEl.value?.focus())
  keyModal.open = true
  keyModal.name = ''
  keyModal.type = 'ed25519'
  keyModal.passphrase = ''
  keyModal.error = ''
  keyModal.busy = false
}
async function generateKey(e?: Event): Promise<void> {
  // The Enter that commits an IME candidate belongs to the input method: taking
  // it here would generate a key named after the half-typed text.
  if (isImeKey(e)) return
  if (e) e.preventDefault()
  // A double Enter / double click must not spawn two keypairs.
  if (keyBusy.value) return
  // ssh-keygen takes a moment: a second Enter / click must not race the first.
  if (keyModal.busy) return
  keyModal.error = ''
  const name = keyModal.name.trim()
  if (!name) {
    keyModal.error = t('host.keyNameReq')
    return
  }
  keyBusy.value = true
  keyModal.busy = true
  try {
    const r = await window.api.keys.generate({
      name,
      type: keyModal.type,
      passphrase: keyModal.passphrase || undefined
    })
    if (!r.ok || !r.key) {
      keyModal.error = r.code || r.error ? keyErrorMessage(r, t) : t('host.keyGenFail')
      keyModal.error = r.error ?? t('host.keyGenFail')
      return
    }
    keyModal.open = false
    form.keyPath = r.key.path
    await loadKeys()
    if (r.key.passphraseProtected === false) toast(t('host.keyUnprotected'), 'info')
  } finally {
    keyBusy.value = false
    keyModal.busy = false
  const r = await window.api.keys.generate({
    name,
    type: keyModal.type,
    passphrase: keyModal.passphrase || undefined
  })
  if (!r.ok || !r.key) {
    // Match importKey: modal error alone is easy to miss; toast the same string.
    const msg = r.error ?? t('host.keyGenFail')
    keyModal.error = msg
    toast(msg, 'error')
    return
  }

  keyModal.open = false
  form.keyPath = r.key.path
  // Keep the passphrase the user just typed for generation — otherwise canSave
  // would still block a passphraseProtected key, and connect would fail late.
  if (keyModal.passphrase) {
    passphrase.value = keyModal.passphrase
    keyModal.passphrase = ''
  }
  await loadKeys()
  if (r.key.passphraseProtected === false) toast(t('host.keyUnprotected'), 'info')
}
async function importKey(): Promise<void> {
  if (keyBusy.value) return
  keyBusy.value = true
  if (importing.value) return
  importing.value = true
  try {
    const r = await window.api.keys.import()
    if (r.canceled) return
    if (!r.ok || !r.key) {
      toast(r.code || r.error ? keyErrorMessage(r, t) : t('host.keyImportFail'), 'error')
      toast(r.error ?? t('host.keyImportFail'), 'error')
      return
    }
    form.keyPath = r.key.path
    await loadKeys()
    if (r.key.passphraseProtected === false) toast(t('host.keyUnprotected'), 'info')
  } finally {
    keyBusy.value = false
    importing.value = false
  const r = await window.api.keys.import()
  if (r.canceled) return
  if (!r.ok || !r.key) {
    toast(keyOpError(r.error), 'error')
    return
  }
}
async function deleteKey(k: ManagedKey): Promise<void> {
  if (deletingId.value) return
  const res = await confirm(t('host.keyDeleteConfirm', { name: k.name }))
  if (!res) return
  const r = await window.api.keys.del(k.id)
  if (r.ok) {
    if (form.keyPath === k.path) form.keyPath = ''
    await loadKeys()
  } else {
    toast(keyErrorMessage(r, t), 'error')
  deletingId.value = k.id
  try {
    const r = await window.api.keys.del(k.id)
    if (r.ok) {
      if (form.keyPath === k.path) form.keyPath = ''
      await loadKeys()
    } else if (r.error) {
      toast(r.error, 'error')
    }
  } finally {
    deletingId.value = null
    panelEl.value?.focus()
  } else if (r.error) {
    toast(keyOpError(r.error), 'error')
    toast(r.error ?? t('host.keyDeleteFail'), 'error')
  }
}

/** Why the save button is disabled ('' when it isn't). Key auth needs a key
 *  file: Android already refuses this with `edit_err_no_key`, but desktop let
 *  the profile save and only failed later with a Chinese-only message. */
const saveBlockReason = (): string => {
  if (!form.host || !form.username) return t('host.saveDisabled')
  if (form.auth === 'key' && !form.keyPath) return t('host.keyRequired')
  return ''
}
const canSave = (): boolean => !saveBlockReason()
const selectedManagedKey = (): ManagedKey | undefined =>
  managedKeys.value.find((k) => k.path === form.keyPath)

/** True when the chosen managed key is known to be encrypted and we have no
 *  typed passphrase and no previously saved one — Android refuses this at save. */
const keyPassphraseMissing = (): boolean => {
  if (form.auth !== 'key') return false
  if (passphrase.value) return false
  if (props.host?.hasSavedPassphrase) return false
  return selectedManagedKey()?.passphraseProtected === true
}

const canSave = (): boolean =>
  !!form.host && !!form.username && !keyPassphraseMissing()

const saveBlockReason = (): string => {
  if (!form.host || !form.username) return t('host.saveDisabled')
  if (keyPassphraseMissing()) return t('host.passphraseRequired')
  return ''
}

// ---- Tags: type, Enter (or comma) adds; Backspace on an empty box removes the last ----
const tagDraft = ref('')
function commitTag(): boolean {
  const added = tagDraft.value
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter((x) => x && !form.tags.includes(x))
  tagDraft.value = ''
  if (!added.length) return false
  form.tags.push(...added)
  return true
}
function onTagKey(e: KeyboardEvent): void {
  if (isImeKey(e)) return
  if ((e.key === 'Enter' || e.key === ',' || e.key === '，') && tagDraft.value.trim()) {
    // Ours, not the editor's "Enter saves".
    e.preventDefault()
    e.stopPropagation()
    commitTag()
  } else if (e.key === 'Backspace' && !tagDraft.value && form.tags.length) {
    form.tags.pop()
  }
}

async function save(): Promise<void> {
  splitHostInput()
  if (!canSave() || saving.value) return
  if (!canSave()) {
    // Enter in a field reaches save() even while the button is disabled; say
    // why instead of doing nothing.
    if (form.auth === 'key' && !form.keyPath) toast(t('host.keyRequired'), 'error')
    return
  }
  commitTag()
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
    tags: form.tags.length ? [...form.tags] : undefined,
    jumpHostId: form.jumpHostId || undefined,
    color: form.color.trim() || undefined,
    terminalTheme: form.terminalTheme || undefined,
    terminalFontFamily: form.terminalFontFamily.trim() || undefined,
    agentForward: form.agentForward || undefined,
    onConnect: form.onConnect.trim() || undefined,
    onConnectDelayMs: Number(form.onConnectDelayMs) > 0 ? Number(form.onConnectDelayMs) : undefined,
    portForwards: forwards.length ? forwards : undefined,
    proxy: form.proxyOn && form.proxyHost.trim()
      ? {
          host: form.proxyHost.trim(),
          port: Number(form.proxyPort) || (form.proxyType === 'socks5' ? 1080 : 8080),
          type: form.proxyType,
          ...(form.proxyUser ? { username: form.proxyUser.trim() } : {}),
          ...(form.proxyUser && form.proxyPass ? { password: form.proxyPass } : {})
        }
      : undefined,
    // Not edited here, but part of the saved profile: without these an edit
    // dropped the host to the bottom of 最近使用 and lost its OS icon. The OS
    // is only kept while the address is the same machine.
    lastUsedAt: props.host?.lastUsedAt,
    os:
      props.host && props.host.host === form.host.trim() && (props.host.port || 22) === (Number(form.port) || 22)
        ? props.host.os
        : undefined
  }
  // A typed password/passphrase is saved (encrypted); leaving it blank keeps any
  // previously saved secret untouched (empty → undefined, store won't overwrite).
  const pw = form.auth === 'password' && password.value ? password.value : undefined
  const pp = form.auth === 'key' && passphrase.value ? passphrase.value : undefined
  saving.value = true
  try {
    store.hosts = await window.api.hosts.save(host, pw, pp)
  } catch {
    // Main rejects when the hosts file cannot be written (disk full, unreadable
    // file). Without this the panel just sat there with nothing said.
    toast(t('ed.saveFail'), 'error')
    return
  } finally {
    saving.value = false
  }
  emit('close')
}

/** Enter in any field saves — the password field especially, where finishing
 *  typing and hitting Enter is the natural end of the flow. Enter on a button
 *  keeps its native meaning (so Esc/取消/删除 still work as pressed), except
 *  with Ctrl/Cmd held, which saves from anywhere. */
function onEnter(e: KeyboardEvent): void {
  // The Enter that commits an IME candidate (typing 生产 into 名称) arrives here
  // too — that one belongs to the input method, not to us.
  if (isImeKey(e)) return
  const inField = (e.target as HTMLElement | null)?.tagName === 'INPUT'
  if (!inField && !(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  void save()
}

async function remove(): Promise<void> {
  if (!props.host) return
  const host = props.host
  // Same warning as the host list: other hosts may point at this one as their
  // jump host, and they stop connecting once it is gone.
  const deps = store.hosts.filter((x) => x.jumpHostId === host.id)
  const msg = deps.length
    ? t('hosts.deleteConfirmJump', { name: host.label, n: deps.length })
    : t('hosts.deleteConfirm', { name: host.label })
  const ok = await confirm(msg, {
    title: t('hosts.delete'),
    confirmText: t('hosts.delete'),
    danger: true
  })
  if (!ok) return
  try {
    store.hosts = await window.api.hosts.delete(props.host.id)
  } catch {
    // Main rejects when the hosts file cannot be written (disk full, unreadable
    // file). Without this the panel just sat there with nothing said.
    toast(t('hosts.deleteFail'), 'error')
    return
  }
  store.hosts = await window.api.hosts.delete(host.id)
  emit('close')
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="open" class="layer" @mousedown.self="void requestClose()">
      <aside ref="panelEl" class="panel" role="dialog" aria-modal="true" aria-labelledby="he-kicker" tabindex="-1" @keydown.esc="void requestClose()" @keydown.enter="onEnter">
        <!-- Header: the host as a card shows it — avatar, name, address. -->
        <header class="p-head">
          <OsIcon :os="host?.os" :color="form.color || undefined" :size="44" />
          <div class="p-title">
            <span id="he-kicker" class="p-kicker">{{ host ? t('host.titleEdit') : t('host.titleNew') }}</span>
            <input
              ref="labelEl"
              v-model="form.label"
              class="p-name"
              :placeholder="form.host ? `${form.username || 'root'}@${form.host}` : t('host.name')"
              spellcheck="false"
            />
          </div>
          <button class="p-close" :title="t('host.cancel')" @click="void requestClose()"><Icon name="close" :size="15" /></button>
        </header>

        <div class="p-body">
          <!-- ---- 连接 ---- -->
          <section class="group">
            <h3>{{ t('host.secConn') }}</h3>
            <div class="card">
              <div class="row">
                <label class="r-label" for="he-host">{{ t('host.host') }}</label>
                <input
                  id="he-host"
                  v-model="form.host"
                  class="r-input mono"
                  :placeholder="t('host.hostPh')"
                  spellcheck="false"
                  @paste="onHostPaste"
                  @blur="splitHostInput"
                />
                <span class="port">
                  <label class="colon" for="he-port">:</label>
                  <input id="he-port" v-model.number="form.port" class="r-input mono port-in" type="number" min="1" max="65535" :aria-label="t('host.port')" />
                </span>
              </div>
              <label class="row">
                <span class="r-label">{{ t('host.username') }}</span>
                <input v-model="form.username" class="r-input mono" :placeholder="t('host.usernamePh')" spellcheck="false" />
              </label>
              <div class="row">
                <span class="r-label">{{ t('host.auth') }}</span>
                <div class="seg">
                  <button
                    v-for="a in (['password', 'key', 'agent'] as AuthMethod[])"
                    :key="a"
                    type="button"
                    :class="{ on: form.auth === a }"
                    @click="form.auth = a"
                  >
                    {{ authLabels[a] }}
                  </button>
                </div>
              </div>

              <label v-if="form.auth === 'password'" class="row">
                <span class="r-label">{{ t('host.password') }}</span>
                <input
                  v-model="password"
                  class="r-input"
                  type="password"
                  :placeholder="host?.hasSavedPassword ? t('host.passwordSaved') : t('host.passwordAsk')"
                />
              </label>

              <template v-else-if="form.auth === 'key'">
                <div class="row">
                  <span class="r-label">{{ t('host.privateKey') }}</span>
                  <div v-if="managedKeys.length" class="r-select">
                    <select :value="form.keyPath || ''" @change="useKey(($event.target as HTMLSelectElement).value)">
                      <option value="">{{ t('host.noKey') }}</option>
                      <option v-for="k in managedKeys" :key="k.id" :value="k.path">{{ keyOptionLabel(k) }}</option>
                      <!-- Hosts imported from ssh config / older data point at an
                           external path: keep it visible instead of a blank select. -->
                      <option v-if="form.keyPath && !managedKeys.some((k) => k.path === form.keyPath)" :value="form.keyPath">
                        {{ form.keyPath }}
                      </option>
                    </select>
                    <Icon name="chevron-down" :size="14" class="caret" />
                  </div>
                  <button v-else-if="keysFailed" type="button" class="r-pick" :title="t('host.keyListFail')" @click="loadKeys">
                    <span class="dim">{{ t('host.keyListFail') }} · {{ t('host.retry') }}</span>
                  </button>
                  <button v-else type="button" class="r-pick" :title="form.keyPath || t('host.browse')" @click="pickKey">
                    <span :class="{ dim: !form.keyPath }">{{ form.keyPath || t('host.noKey') }}</span>
                  </button>
                  <div class="r-actions">
                    <button type="button" class="link" @click="pickKey">{{ t('host.browse') }}</button>
                    <button type="button" class="link" @click="openGenerate">{{ t('host.generateKey') }}</button>
                    <button type="button" class="link" :disabled="importing" @click="importKey">{{ t('host.importKey') }}</button>
                  </div>
                </div>
                <label class="row">
                  <span class="r-label">{{ t('host.passphrase') }}</span>
                  <input
                    v-model="passphrase"
                    class="r-input"
                    type="password"
                    :placeholder="host?.hasSavedPassphrase ? t('host.passphraseSaved') : t('host.passphraseAsk')"
                  />
                </label>
                <template v-if="managedKeys.length">
                  <button type="button" class="row disclosure" @click="sections.keys = !sections.keys">
                    <span class="r-label wide">{{ t('host.manageKeys') }}</span>
                    <span class="r-summary">{{ managedKeys.length }}</span>
                    <Icon name="chevron-right" :size="14" class="chev" :class="{ open: sections.keys }" />
                  </button>
                  <div v-if="sections.keys" class="sub">
                    <div v-for="k in managedKeys" :key="k.id" class="key-item">
                      <span class="key-name" :title="k.fingerprint">{{ k.name }}</span>
                      <span v-if="k.type" class="chip">{{ k.type }}</span>
                      <button type="button" class="icon-x" :title="t('host.deleteKey')" :disabled="!!deletingId" @click="deleteKey(k)"><Icon name="trash" :size="13" /></button>
                    </div>
                  </div>
                </template>
              </template>

              <div v-else class="row note">{{ t('host.agentNote') }}</div>
            </div>
          </section>

          <!-- ---- 整理 ---- -->
          <section class="group">
            <h3>{{ t('host.secOrganize') }}</h3>
            <div class="card">
              <label class="row">
                <span class="r-label">{{ t('host.group') }}</span>
                <input v-model="form.group" class="r-input" :placeholder="t('host.groupPh')" spellcheck="false" />
              </label>
              <div class="row" @click.self="tagInputEl?.focus()">
                <label class="r-label" for="he-tags">{{ t('host.tags') }}</label>
                <span class="tag-box" @click.self="tagInputEl?.focus()">
                  <span v-for="(tg, i) in form.tags" :key="tg" class="chip">
                    {{ tg }}<button type="button" :title="t('fw.remove')" @click="form.tags.splice(i, 1)"><Icon name="close" :size="9" /></button>
                  </span>
                  <input
                    id="he-tags"
                    ref="tagInputEl"
                    v-model="tagDraft"
                    :placeholder="form.tags.length ? '' : t('host.tagsPh')"
                    spellcheck="false"
                    @keydown="onTagKey"
                    @blur="commitTag"
                  />
                </span>
              </div>
              <div class="row">
                <span class="r-label">{{ t('host.color') }}</span>
                <div class="swatches">
                  <button type="button" class="swatch none" :class="{ on: !form.color }" :title="t('host.colorNone')" @click="form.color = ''" />
                  <button
                    v-for="c in COLORS"
                    :key="c"
                    type="button"
                    class="swatch"
                    :class="{ on: form.color === c }"
                    :style="{ '--c': c }"
                    :title="c"
                    :aria-label="c"
                    @click="form.color = c"
                  />
                </div>
              </div>
            </div>
          </section>

          <!-- ---- 更多选项: one row each, opened in place ---- -->
          <section class="group">
            <h3>{{ t('host.secMore') }}</h3>
            <div class="card">
              <div class="row" :title="jumpBlocked ? undefined : t('host.jumpHint')">
                <span class="r-label wide">{{ t('host.jump') }}</span>
                <div class="r-select end">
                  <select v-model="form.jumpHostId" :disabled="jumpBlocked">
                    <option value="">{{ t('host.jumpNone') }}</option>
                    <option v-for="j in jumpOptions" :key="j.id" :value="j.id">{{ j.label }} · {{ j.username }}@{{ j.host }}</option>
                    <option v-for="j in jumpCandidates" :key="j.id" :value="j.id">{{ j.label }} · {{ j.username }}@{{ j.host }}</option>
                    <!-- The saved jump host was deleted: keep the stale id visible
                         instead of a blank select while v-model still holds it. -->
                    <option v-if="jumpGone" :value="form.jumpHostId">{{ t('host.jumpDeleted') }}</option>
                  </select>
                  <Icon name="chevron-down" :size="14" class="caret" />
                </div>
              </div>
              <p v-if="jumpBlocked" class="sub-hint jump-hint">{{ t('host.jumpBlocked', { label: jumpBlockerLabel }) }}</p>
              <p v-if="jumpGone || jumpBlocked" class="sub-hint jump-hint">
                {{ jumpGone ? t('host.jumpGone') : t('host.jumpBlocked', { name: jumpUsedBy[0].label }) }}
              </p>
              <p v-if="jumpNested" class="sub-hint jump-hint">{{ t('host.jumpNested') }}</p>

              <button type="button" class="row disclosure" @click="sections.proxy = !sections.proxy">
                <span class="r-label wide">{{ t('host.proxy') }}</span>
                <span class="r-summary">{{ proxySummary }}</span>
                <Icon name="chevron-right" :size="14" class="chev" :class="{ open: sections.proxy }" />
              </button>
              <div v-if="sections.proxy" class="sub">
                <p class="sub-hint">{{ t('host.proxyHint') }}</p>
                <label class="toggle-line">
                  <span>{{ t('host.proxyOn') }}</span>
                  <input v-model="form.proxyOn" type="checkbox" class="switch" />
                </label>
                <template v-if="form.proxyOn">
                  <div class="sub-grid">
                    <div class="seg small">
                      <button type="button" :class="{ on: form.proxyType === 'socks5' }" @click="form.proxyType = 'socks5'">SOCKS5</button>
                      <button type="button" :class="{ on: form.proxyType === 'http' }" @click="form.proxyType = 'http'">HTTP</button>
                    </div>
                    <input v-model="form.proxyHost" class="box mono grow" :placeholder="t('host.proxyHostPh')" spellcheck="false" />
                    <input v-model.number="form.proxyPort" class="box mono port-box" type="number" min="1" max="65535" :placeholder="t('host.proxyPortPh')" />
                  </div>
                  <div class="sub-grid">
                    <input v-model="form.proxyUser" class="box grow" :placeholder="t('host.proxyUserPh')" autocomplete="off" />
                    <input v-model="form.proxyPass" class="box grow" type="password" :placeholder="t('host.proxyPassPh')" autocomplete="off" />
                  </div>
                </template>
              </div>

              <button type="button" class="row disclosure" @click="sections.forwards = !sections.forwards">
                <span class="r-label wide">{{ t('nav.forwards') }}</span>
                <span class="r-summary">{{ form.forwards.length ? t('host.fwCount', { n: form.forwards.length }) : t('host.none') }}</span>
                <Icon name="chevron-right" :size="14" class="chev" :class="{ open: sections.forwards }" />
              </button>
              <div v-if="sections.forwards" class="sub">
                <p class="sub-hint">{{ t('host.fwHint') }}</p>
                <div v-for="(f, i) in form.forwards" :key="i" class="sub-grid">
                  <div class="r-select box-select">
                    <select v-model="f.mode">
                      <option value="local">{{ t('host.fwLocalMode') }}</option>
                      <option value="remote">{{ t('host.fwRemoteMode') }}</option>
                      <option value="dynamic">{{ t('host.fwDynamicMode') }}</option>
                    </select>
                    <Icon name="chevron-down" :size="13" class="caret" />
                  </div>
                  <input v-model.number="f.localPort" class="box mono port-box" type="number" min="1" max="65535" :placeholder="t('host.fwListen')" />
                  <template v-if="f.mode !== 'dynamic'">
                    <input v-model="f.host" class="box mono grow" :placeholder="f.mode === 'remote' ? t('host.fwLocalTarget') : t('host.fwRemoteHost')" spellcheck="false" />
                    <input v-model.number="f.remotePort" class="box mono port-box" type="number" min="1" max="65535" :placeholder="t('host.fwTarget')" />
                  </template>
                  <span v-else class="grow" />
                  <button type="button" class="icon-x" :title="t('fw.remove')" @click="removeForward(i)"><Icon name="close" :size="13" /></button>
                </div>
                <button type="button" class="add-line" @click="addForward">{{ t('set.gen.addForward') }}</button>
              </div>

              <button type="button" class="row disclosure" @click="sections.onConnect = !sections.onConnect">
                <span class="r-label wide">{{ t('host.onConnect') }}</span>
                <span class="r-summary mono">{{ onConnectSummary }}</span>
                <Icon name="chevron-right" :size="14" class="chev" :class="{ open: sections.onConnect }" />
              </button>
              <div v-if="sections.onConnect" class="sub">
                <p class="sub-hint">{{ t('host.onConnectHint') }}</p>
                <textarea v-model="form.onConnect" class="box mono ta" :placeholder="t('host.onConnectPh')" rows="3" spellcheck="false" />
                <label class="toggle-line">
                  <span>{{ t('host.onConnectDelay') }}</span>
                  <input v-model.number="form.onConnectDelayMs" class="box mono port-box" type="number" min="0" max="30000" step="100" :placeholder="t('host.onConnectDelayPh')" />
                </label>
              </div>

              <button type="button" class="row disclosure" @click="sections.appearance = !sections.appearance">
                <span class="r-label wide">{{ t('host.appearance') }}</span>
                <span class="r-summary">{{ appearanceSummary }}</span>
                <Icon name="chevron-right" :size="14" class="chev" :class="{ open: sections.appearance }" />
              </button>
              <div v-if="sections.appearance" class="sub">
                <div class="sub-grid">
                  <div class="r-select box-select grow">
                    <select v-model="form.terminalTheme">
                      <option value="">{{ t('host.termThemeSystem') }}</option>
                      <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                    <Icon name="chevron-down" :size="13" class="caret" />
                  </div>
                  <input v-model="form.terminalFontFamily" class="box grow" :placeholder="t('host.termFontPh')" spellcheck="false" />
                </div>
              </div>

              <label class="row">
                <span class="r-label wide">{{ t('host.agentForward') }}</span>
                <input v-model="form.agentForward" type="checkbox" class="switch" />
              </label>
            </div>
          </section>
        </div>

        <footer class="p-foot">
          <button v-if="host" type="button" class="btn btn-danger" @click="remove">{{ t('host.delete') }}</button>
          <span class="spacer" />
          <button type="button" class="btn" @click="void requestClose()">{{ t('host.cancel') }}</button>
          <button type="button" class="btn btn-primary" :disabled="!canSave() || saving" :title="canSave() ? undefined : t('host.saveDisabled')" @click="save">{{ saving ? t('ed.saving') : t('host.save') }}</button>

          <button type="button" class="btn btn-primary" :disabled="!canSave()" :title="canSave() ? undefined : saveBlockReason()" @click="save">{{ t('host.save') }}</button>
        </footer>

        <!-- Generate a key: a small sheet over the panel. -->
        <div v-if="keyModal.open" class="key-layer" @mousedown.self="closeKeySheet">
          <div ref="keySheetEl" class="key-sheet" tabindex="-1" @keydown.esc.stop="closeKeySheet">
            <h3>{{ t('host.generateKey') }}</h3>
            <div class="card">
              <label class="row">
                <span class="r-label">{{ t('host.keyName') }}</span>
                <input ref="keyNameEl" v-model="keyModal.name" class="r-input" :placeholder="t('host.keyNamePh')" :disabled="keyModal.busy" @keydown.enter.stop="generateKey($event)" />
              </label>
              <div class="row">
                <span class="r-label">{{ t('host.keyType') }}</span>
                <div class="seg">
                  <button v-for="ty in ['ed25519', 'rsa', 'ecdsa']" :key="ty" type="button" :class="{ on: keyModal.type === ty }" :disabled="keyModal.busy" @click="keyModal.type = ty">{{ ty }}</button>
                </div>
              </div>
              <label class="row">
                <span class="r-label">{{ t('host.passphrase') }}</span>
                <input v-model="keyModal.passphrase" class="r-input" type="password" :placeholder="t('host.passphraseAsk')" :disabled="keyModal.busy" @keydown.enter.stop="generateKey($event)" />
              </label>
            </div>
            <p v-if="keyModal.error" class="err">{{ keyModal.error }}</p>
            <div class="key-actions">
              <button type="button" class="btn" @click="closeKeySheet">{{ t('host.cancel') }}</button>
              <button type="button" class="btn btn-primary" :disabled="keyBusy" @click="generateKey">{{ t('host.save') }}</button>
              <button type="button" class="btn" :disabled="keyModal.busy" @click="closeKeySheet">{{ t('host.cancel') }}</button>
              <button type="button" class="btn btn-primary" :disabled="keyModal.busy" @click="generateKey">{{ keyModal.busy ? t('host.keyGenerating') : t('host.save') }}</button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
/* A sheet from the right: the host list stays in view behind it. Grouped
   rows (label left, control right, hairline between) — the same card language
   as the 连接 page. */
.layer {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.32);
}
.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(520px, calc(100vw - 64px));
  height: 100%;
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: -24px 0 60px -30px rgba(0, 0, 0, 0.55);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s var(--ease);
}
.sheet-enter-active .panel,
.sheet-leave-active .panel {
  transition: transform 0.22s var(--ease);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .panel,
.sheet-leave-to .panel {
  transform: translateX(28px);
}

/* ---- Header ---- */
.p-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 24px 18px;
}
.p-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.p-kicker {
  font-size: 12px;
  color: var(--text-faint);
}
.p-name {
  width: 100%;
  padding: 0;
  font-size: 20px;
  font-weight: 650;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
}
.p-name::placeholder {
  color: var(--text-faint);
  font-weight: 600;
}
.p-close {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--r-pill);
  color: var(--text-dim);
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.p-close:hover {
  background: var(--hover);
  color: var(--text);
}

/* ---- Body ---- */
.p-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.group h3,
.key-sheet h3 {
  margin: 0 0 8px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-faint);
}
.card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 46px;
  padding: 6px 16px;
  text-align: left;
  font-size: 13px;
  color: var(--text);
}
.row + .row,
.sub + .row,
.row + .sub {
  border-top: 1px solid var(--border);
}
.r-label {
  flex: none;
  width: 84px;
  color: var(--text-dim);
}
.r-label.wide {
  flex: 1;
  width: auto;
  color: var(--text);
}
/* Borderless field filling the rest of the row; the row is the frame. */
.r-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0;
  font-size: 13px;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
}
.mono {
  font-family: var(--font-mono);
}
.row:focus-within:not(.disclosure) {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}
.port {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
.colon {
  color: var(--text-faint);
}
.port-in {
  width: 56px;
  flex: none;
}
input[type='number'] {
  -moz-appearance: textfield;
}
input[type='number']::-webkit-outer-spin-button,
input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Segmented control (compact → rounded rectangle; thumb concentric 8 − 2). */
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  margin-left: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.seg button {
  height: 26px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--text-dim);
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.seg button:hover {
  color: var(--text);
}
.seg button.on {
  color: var(--text);
  background: var(--thumb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
.seg.small button {
  height: 28px;
}
.row .seg {
  margin-left: 0;
}

/* Inline select: borderless, caret on the right. */
.r-select {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.r-select select {
  width: 100%;
  height: 32px;
  padding: 0 22px 0 0;
  font-size: 13px;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
  appearance: none;
  cursor: pointer;
  text-overflow: ellipsis;
}
.r-select .caret {
  position: absolute;
  right: 0;
  color: var(--text-faint);
  pointer-events: none;
}
/* A select standing in for a row's value: right-aligned like the summaries. */
.r-select.end {
  flex: 0 1 auto;
  max-width: 62%;
}
.r-select.end select {
  text-align: right;
  text-align-last: right;
  color: var(--text-dim);
}
.r-pick {
  flex: 1;
  min-width: 0;
  height: 32px;
  text-align: left;
  font-size: 12.5px;
  font-family: var(--font-mono);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-pick .dim,
.dim {
  color: var(--text-faint);
  font-family: inherit;
}
.r-actions {
  flex: none;
  display: flex;
  gap: 2px;
}
.link {
  height: 26px;
  padding: 0 8px;
  border-radius: var(--r-pill);
  font-size: 12.5px;
  color: var(--accent);
  transition: background 0.16s var(--ease);
}
.link:hover {
  background: var(--accent-soft);
}
.note {
  font-size: 12.5px;
  color: var(--text-dim);
}

/* Disclosure rows: summary + chevron, the detail opens underneath. */
.disclosure {
  cursor: pointer;
  transition: background 0.16s var(--ease);
}
.disclosure:hover {
  background: var(--hover);
}
.r-summary {
  flex: none;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text-faint);
}
.chev {
  flex: none;
  color: var(--text-faint);
  transition: transform 0.18s var(--ease);
}
.chev.open {
  transform: rotate(90deg);
}
.sub {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px 12px 16px;
  background: color-mix(in srgb, var(--bg) 55%, var(--bg-elev));
}
.sub-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-dim);
}
/* The jump row's "already used as a bastion" note sits directly in the card,
   so it carries the row's own horizontal padding. */
.jump-hint {
  padding: 0 16px 10px;
}
/* Jump-host warning under its row (deleted jump / this host is a jump itself). */
.jump-hint {
  padding: 0 16px 10px;
}
.jump-hint + .row {
  border-top: 1px solid var(--border);
}
/* The jump row's warning sits directly under the select, inside the card. */
.jump-hint {
  padding: 0 16px 10px;
}
.panel:focus {
  outline: none;
}
.sub-grid {
  display: flex;
  align-items: center;
  gap: 8px;
}
.grow {
  flex: 1;
  min-width: 0;
}
/* Boxed fields for the denser editors inside a disclosure. */
.box {
  height: 32px;
  padding: 0 10px;
  font-size: 12.5px;
  color: var(--text);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.16s var(--ease);
}
.box:focus {
  border-color: var(--accent);
}
.port-box {
  width: 78px;
  flex: none;
}
.ta {
  width: 100%;
  height: auto;
  min-height: 68px;
  padding: 8px 10px;
  line-height: 1.5;
  resize: vertical;
}
.box-select {
  flex: none;
  width: 108px;
  height: 32px;
  padding: 0 8px 0 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.box-select.grow {
  flex: 1;
  width: auto;
}
.box-select select {
  font-size: 12.5px;
}
.box-select .caret {
  right: 8px;
}
.toggle-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.add-line {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--r-pill);
  font-size: 12.5px;
  color: var(--accent);
  transition: background 0.16s var(--ease);
}
.add-line:hover {
  background: var(--accent-soft);
}
.icon-x {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-pill);
  color: var(--text-faint);
  transition: background 0.16s var(--ease), color 0.16s var(--ease);
}
.icon-x:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

/* Tags */
.tag-box {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  padding: 4px 0;
}
.tag-box input {
  flex: 1;
  min-width: 80px;
  height: 26px;
  padding: 0;
  font-size: 13px;
  color: var(--text);
  background: none;
  border: none;
  outline: none;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px 0 9px;
  font-size: 12px;
  line-height: 22px;
  color: var(--text-dim);
  background: var(--hover);
  border-radius: var(--r-pill);
}
.chip button {
  display: flex;
  padding: 3px;
  border-radius: var(--r-pill);
  color: var(--text-faint);
}
.chip button:hover {
  color: var(--text);
  background: var(--hover);
}
.key-item .chip {
  padding: 0 9px;
}

/* Colour swatches */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 0;
}
.swatch {
  width: 18px;
  height: 18px;
  border-radius: var(--r-pill);
  background: var(--c);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  transition: transform 0.12s var(--ease), box-shadow 0.16s var(--ease);
}
.swatch:hover {
  transform: scale(1.12);
}
.swatch.on {
  box-shadow: 0 0 0 2px var(--bg-elev), 0 0 0 4px var(--c, var(--text-dim));
}
.swatch.none {
  --c: var(--text-faint);
  background:
    linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%),
    var(--bg);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
.swatch.none.on {
  box-shadow: inset 0 0 0 1px var(--border-strong), 0 0 0 2px var(--bg-elev), 0 0 0 4px var(--text-dim);
}

/* Switch (a styled checkbox) */
.switch {
  flex: none;
  position: relative;
  width: 36px;
  height: 22px;
  margin: 0;
  border-radius: var(--r-pill);
  background: var(--border-strong);
  appearance: none;
  cursor: pointer;
  transition: background 0.18s var(--ease);
}
.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  transition: transform 0.18s var(--ease);
}
.switch:checked {
  background: var(--accent);
}
.switch:checked::after {
  transform: translateX(14px);
}
.switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Managed keys */
.key-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.key-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- Footer ---- */
.p-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 24px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.spacer {
  flex: 1;
}

/* ---- Generate-key sheet ---- */
.key-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.35);
}
.key-sheet {
  width: 100%;
  padding: 18px;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.key-sheet:focus {
  outline: none;
}
.err {
  margin: 10px 4px 0;
  font-size: 12px;
  color: var(--danger);
}
.key-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
</style>
