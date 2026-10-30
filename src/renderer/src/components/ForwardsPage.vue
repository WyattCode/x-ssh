<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useSessions, forwardKey, type Pane, type ForwardGroup, type ForwardRow } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { useConfirm } from '../composables/confirm'
import { useToast } from '../composables/toast'
import type { ForwardMode, Host, HostForward } from '../../../shared/types'
import Icon from './Icon.vue'
import OsIcon from './OsIcon.vue'

// All port forwards in one place: the rules saved on each host (opened by main
// on every connect) plus the temporary ones added to a live session. A saved
// rule is "running" while its host has a connected session.
const store = useSessions()
const { t } = useI18n()
const { confirm } = useConfirm()
const { toast } = useToast()

const key = forwardKey
const sections = computed(() => store.forwardGroups)
const total = computed(() => sections.value.reduce((n, g) => n + g.rows.length, 0))
/** Connected panes: the first per saved host, and sessions that aren't saved hosts. */
const livePanes = computed(() => {
  const byHost = new Map<string, Pane>()
  const loose: { pane: Pane; title: string }[] = []
  for (const tab of store.tabs) {
    for (const p of tab.panes) {
      if (p.status !== 'connected') continue
      const hid = p.params.hostId
      if (hid && store.hosts.some((h) => h.id === hid)) {
        if (!byHost.has(hid)) byHost.set(hid, p)
      } else loose.push({ pane: p, title: tab.title })
    }
  }
  return { byHost, loose }
})

const modeLabel = (m?: ForwardMode): string =>
  (m ?? 'local') === 'local' ? t('status.fwLocal') : m === 'remote' ? t('status.fwRemote') : t('status.fwDynamic')
function ruleText(f: HostForward): string {
  // The mode chip already says SOCKS.
  if ((f.mode ?? 'local') === 'dynamic') return `127.0.0.1:${f.localPort}`
  return `${f.localPort} → ${f.remoteHost || '127.0.0.1'}:${f.remotePort}`
}

// ---- Remove ----
// One removal at a time: each save rewrites the host's whole rule list.
const busyKey = ref('')
async function remove(s: ForwardGroup, row: ForwardRow): Promise<void> {
  if (busyKey.value) return
  if (row.saved && !(await confirm(t('fwp.removeConfirm', { rule: ruleText(row.rule) }), { danger: true, confirmText: t('fw.remove') }))) return
  busyKey.value = `${s.id}|${key(row.rule)}`
  try {
    // Stop it now if it's running.
    if (row.running && s.pane) {
      const r = await store.removeForwardFrom(s.pane, row.rule.mode, row.rule.localPort)
      if (!r.ok && !row.saved) toast(r.error ?? t('fw.fail'), 'error')
    }
    if (row.saved && s.host) {
      // The host as it is now, not as it was when the page last rendered.
      const host = store.hosts.find((h) => h.id === s.host!.id)
      if (host) {
        const left = (host.portForwards ?? []).filter((f) => key(f) !== key(row.rule))
        await store.saveHost({ ...host, portForwards: left.length ? left : undefined })
      }
    }
  } catch (e) {
    toast(String((e as Error)?.message ?? e), 'error')
  } finally {
    busyKey.value = ''
  }
}
// Rules saved on a host open when it connects: offer that from its header.
// One connect at a time per host: the button stays put until the session is up
// (stay: true shows nothing else), so repeated clicks would open more tabs.
const connecting = ref('')
async function connectHost(h: Host): Promise<void> {
  if (connecting.value) return
  connecting.value = h.id
  try {
    if ((await store.quickConnect(h, { stay: true })) === 'needs-password') store.askPasswordFor(h)
  } finally {
    connecting.value = ''
  }
}

// ---- Add ----
const formOpen = ref(false)
const form = reactive({
  target: '',
  mode: 'local' as ForwardMode,
  localPort: '',
  host: '',
  remotePort: '',
  save: true
})
const err = ref('')
const busy = ref(false)
/** Saved hosts, then live sessions that aren't saved hosts (those can't keep a rule). */
const targets = computed(() => [
  ...store.hosts.map((h) => ({ value: `h:${h.id}`, label: h.label, saved: true })),
  ...livePanes.value.loose.map(({ pane, title }) => ({ value: `p:${pane.id}`, label: title, saved: false }))
])
watch(formOpen, (open) => {
  if (open && !form.target) {
    const firstLive = [...livePanes.value.byHost.keys()][0]
    form.target = firstLive ? `h:${firstLive}` : targets.value[0]?.value ?? ''
  }
  err.value = ''
})
const targetIsSaved = computed(() => form.target.startsWith('h:'))

async function add(): Promise<void> {
  const lp = Number(form.localPort)
  const rp = Number(form.remotePort)
  if (!Number.isInteger(lp) || lp < 1 || lp > 65535 || (form.mode !== 'dynamic' && (!Number.isInteger(rp) || rp < 1 || rp > 65535))) {
    err.value = t('fw.badPort')
    return
  }
  const rule: HostForward = {
    mode: form.mode,
    localPort: lp,
    remoteHost: form.host.trim() || '127.0.0.1',
    remotePort: form.mode === 'dynamic' ? 0 : rp
  }
  const [kind, id] = [form.target.slice(0, 1), form.target.slice(2)]
  const host = kind === 'h' ? store.hosts.find((h) => h.id === id) : undefined
  const pane = kind === 'h' ? livePanes.value.byHost.get(id) : livePanes.value.loose.find((x) => x.pane.id === id)?.pane
  const save = !!host && form.save
  if (!save && !pane) {
    err.value = t('app.needLiveSession')
    return
  }
  if (host && (host.portForwards ?? []).some((f) => key(f) === key(rule))) {
    err.value = t('fwp.duplicate')
    return
  }
  err.value = ''
  busy.value = true
  try {
    // Start it now first: a port that's already taken fails here, before we save a rule that can't work.
    if (pane) {
      const r = await store.addForwardTo(pane, rule)
      if (!r.ok) {
        err.value = r.error ?? t('fw.fail')
        return
      }
    }
    if (save && host) {
      try {
        await store.saveHost({ ...host, portForwards: [...(host.portForwards ?? []), rule] })
      } catch {
        // Live forward (if any) already started — leave it; tell the user the
        // host profile was not updated so next connect will not reopen this rule.
        err.value = t('ed.saveFail')
        return
      }
    }
    form.localPort = ''
    form.remotePort = ''
    form.host = ''
    formOpen.value = false
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="fw-page">
    <div class="wrap">
      <header class="page-head">
        <h1>{{ t('nav.forwards') }}<span v-if="total" class="count">{{ total }}</span></h1>
        <div class="page-actions">
          <button
            class="btn pill"
            :class="formOpen ? '' : 'btn-primary'"
            :disabled="!targets.length"
            @click="formOpen = !formOpen"
          >
            <Icon :name="formOpen ? 'close' : 'plus'" :size="15" />{{ formOpen ? t('confirm.cancel') : t('fwp.add') }}
          </button>
        </div>
      </header>

      <form v-if="formOpen" class="card form" @submit.prevent="add">
        <label class="field">
          <span>{{ t('fwp.host') }}</span>
          <select v-model="form.target">
            <option v-for="o in targets" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ t('fwp.mode') }}</span>
          <select v-model="form.mode">
            <option value="local">{{ t('status.fwLocal') }}</option>
            <option value="remote">{{ t('status.fwRemote') }}</option>
            <option value="dynamic">{{ t('status.fwDynamic') }}</option>
          </select>
        </label>
        <label class="field narrow">
          <span>{{ t('fw.localPort') }}</span>
          <input v-model="form.localPort" inputmode="numeric" placeholder="8080" spellcheck="false" />
        </label>
        <template v-if="form.mode !== 'dynamic'">
          <label class="field grow">
            <span>{{ t('fw.remoteHost') }}</span>
            <input v-model="form.host" placeholder="127.0.0.1" spellcheck="false" />
          </label>
          <label class="field narrow">
            <span>{{ t('fw.remotePort') }}</span>
            <input v-model="form.remotePort" inputmode="numeric" placeholder="80" spellcheck="false" />
          </label>
        </template>
        <div class="form-foot">
          <label v-if="targetIsSaved" class="check">
            <input v-model="form.save" type="checkbox" />
            <span>{{ t('fwp.saveToHost') }}</span>
          </label>
          <span v-if="err" class="err">{{ err }}</span>
          <button class="btn btn-primary" type="submit" :disabled="busy">{{ t('fw.add') }}</button>
        </div>
      </form>

      <div v-if="!sections.length && !formOpen" class="empty">
        <span class="empty-icon"><Icon name="forward" :size="26" /></span>
        <p>{{ t('fwp.empty') }}</p>
      </div>

      <section v-for="s in sections" :key="s.id" class="card section">
        <div class="sec-head">
          <OsIcon :os="s.host?.os" :color="s.host?.color" :size="34" />
          <div class="sec-title">
            <b>{{ s.title }}</b>
            <small>{{ s.sub }}</small>
          </div>
          <span v-if="s.pane" class="live on"><span class="d" />{{ t('fwp.active') }}</span>
          <!-- Not connected: the button says so and fixes it in one go. -->
          <button v-else-if="s.host" class="btn btn-tinted sm" :title="t('fwp.idle')" :disabled="connecting === s.host.id" @click="connectHost(s.host)">{{ t('hosts.connect') }}</button>
        </div>
        <div v-for="row in s.rows" :key="(row.saved ? 's' : 't') + key(row.rule)" class="rule">
          <span class="mode" :class="row.rule.mode ?? 'local'">{{ modeLabel(row.rule.mode) }}</span>
          <span class="text">{{ ruleText(row.rule) }}</span>
          <span v-if="!row.saved" class="badge temp" :title="t('fwp.tempHint')">{{ t('fwp.temp') }}</span>
          <span v-else />
          <button class="del" :title="t('fw.remove')" :disabled="!!busyKey" @click="remove(s, row)">
            <Icon name="trash" :size="14" />
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.fw-page {
  height: 100%;
  overflow-y: auto;
  background: var(--bg);
}
.wrap {
  max-width: 1320px;
  margin: 0 auto;
  padding: 24px 36px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
}
.form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  padding: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 150px;
  font-size: 12px;
  color: var(--text-faint);
}
.field.narrow {
  min-width: 100px;
  width: 100px;
}
.field.grow {
  flex: 1;
}
.field input,
.field select {
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  outline: none;
}
.field input:focus,
.field select:focus {
  border-color: var(--accent);
}
.form-foot {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  accent-color: var(--accent);
  font-size: 13px;
  color: var(--text-dim);
}
.err {
  font-size: 12px;
  color: var(--danger);
}
.form-foot .btn {
  margin-left: auto;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 80px 0;
  color: var(--text-faint);
  font-size: 13px;
}
.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  color: var(--text-dim);
  background: var(--bg-elev);
  border: 1px solid var(--border);
}
/* Content sits 16px inside the card border on every side, like the form
   above and the 连接 cards: 4px card padding + 12px row padding. */
.section {
  padding: 4px;
}
.sec-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
}
.sec-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sec-title b {
  font-size: 14px;
  font-weight: 600;
}
.sec-title small {
  font-size: 12px;
  color: var(--text-faint);
  font-family: var(--font-mono);
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 3px 9px;
  border-radius: var(--r-pill);
  font-size: 11.5px;
  color: var(--text-faint);
  background: var(--bg-elev-2);
}
.live .d {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.sec-head .btn.sm {
  margin-left: auto;
  height: 26px;
  padding: 0 12px;
  font-size: 12px;
}
.live.on {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 12%, transparent);
}
.rule {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto 28px;
  align-items: center;
  gap: 14px;
  /* Rules hang under the host name: 12 + 34px icon + 12px gap. */
  padding: 9px 12px 9px 58px;
  border-radius: 12px;
}
.rule:hover {
  background: var(--hover);
}
.mode {
  justify-self: start;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  font-size: 11.5px;
  color: var(--accent);
  background: var(--accent-soft);
}
.mode.remote {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.mode.dynamic {
  color: var(--ok);
  background: color-mix(in srgb, var(--ok) 14%, transparent);
}
.text {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  padding: 1px 7px;
  border-radius: var(--r-pill);
  font-size: 11px;
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.badge.temp {
  color: var(--text-faint);
  border-style: dashed;
}
.del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-pill);
  color: var(--text-faint);
}
.del:hover:not(:disabled) {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
</style>
