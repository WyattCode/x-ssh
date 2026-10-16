<script setup lang="ts">
/**
 * The chmod dialog: pick permission bits for the selected remote entries.
 *
 * Extracted from SftpDrawer so the drawer's template stays about browsing. All
 * the bit/octal/symbolic conversions come from lib/fileMode so the three views
 * of the same value provably agree.
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import type { FileEntry } from '../../../shared/types'
import { posixJoin } from '../../../shared/fsUtils'
import { useI18n } from '../lib/i18n'
import { useFocusTrap } from '../composables/focusTrap'
import { BIT_GROUPS, clampMode, parseOctal, sanitizeOctalText, toOctal, toSymbolic } from '../lib/fileMode'
import Icon from './Icon.vue'

const props = defineProps<{
  sessionId: string
  /** Remote directory the targets live in. */
  dir: string
  targets: FileEntry[]
  /** Mode to prefill; falls back to the first target's own mode, then 755. */
  initialMode?: number
}>()

const emit = defineEmits<{
  /** The dialog finished (applied or cancelled); the parent should reload. */
  (e: 'close', payload: { applied: boolean }): void
}>()

const { t: tt } = useI18n()

const bits = ref(props.initialMode ?? props.targets[0]?.mode ?? 0o755)
const recursive = ref(false)
const busy = ref(false)
const error = ref('')
const octalText = ref(toOctal(bits.value))
const dialogEl = ref<HTMLElement>()
// Mounted only while the parent shows this dialog (v-if in SftpDrawer), so
// the trap is active for the component's whole lifetime.
useFocusTrap(dialogEl, () => true)

const groups = computed(() =>
  BIT_GROUPS.map((g) => ({
    label: tt(g.labelKey),
    bits: g.bits.map((b) => ({ l: tt(b.labelKey), m: b.mask }))
  }))
)
const hasDir = computed(() => props.targets.some((t) => t.isDir))
const symbolic = computed(() => toSymbolic(bits.value))

function syncOctal(): void {
  octalText.value = toOctal(bits.value)
}

function toggleBit(mask: number): void {
  bits.value = clampMode(bits.value ^ mask)
  syncOctal()
}

function onOctalInput(e: Event): void {
  const el = e.target as HTMLInputElement
  const v = sanitizeOctalText(el.value)
  // Force the field back to the sanitized text; without this a rejected char
  // (e.g. "8") stays visible while state silently ignores it.
  if (el.value !== v) el.value = v
  octalText.value = v
  const parsed = parseOctal(v)
  bits.value = parsed ?? 0
}

async function apply(): Promise<void> {
  if (busy.value || !props.targets.length) return
  const parsed = parseOctal(octalText.value)
  if (parsed === null) {
    error.value = tt('sfp.permInput')
    return
  }
  busy.value = true
  error.value = ''
  const failed: string[] = []
  try {
    // Apply to every target; don't abort on the first failure so one bad item
    // doesn't hide the outcome of the rest.
    for (const it of props.targets) {
      const r = await window.api.sftp.chmod(
        props.sessionId,
        posixJoin(props.dir, it.name),
        parsed,
        recursive.value,
        it.isDir
      )
      if (!r.ok) failed.push(it.name)
    }
    if (failed.length) {
      error.value =
        failed.length === props.targets.length
          ? tt('sfp.permFail')
          : tt('sfp.permFailMany', { n: failed.length, list: failed.join('、') })
      return
    }
    emit('close', { applied: true })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  e.stopPropagation() // don't let the drawer's global shortcuts fire while the dialog is open
  if (e.key === 'Escape') emit('close', { applied: false })
  else if (e.key === 'Enter') void apply()
}

onMounted(() => nextTick(() => dialogEl.value?.focus()))
</script>

<template>
  <div class="pm-overlay" @mousedown.self="emit('close', { applied: false })">
    <div ref="dialogEl" class="pm-dialog" tabindex="-1" @keydown="onKey">
      <div class="pm-head">
        <span>{{ tt('sfp.perm') }}</span>
        <button class="pm-x" :title="tt('sfp.close')" @click="emit('close', { applied: false })">
          <Icon name="close" />
        </button>
      </div>
      <p class="pm-target">
        {{ targets.length === 1 ? targets[0].name : tt('sfp.permSelected', { n: targets.length }) }}
      </p>
      <div class="pm-grid">
        <div v-for="g in groups" :key="g.label" class="pm-col">
          <div class="pm-col-h">{{ g.label }}</div>
          <label v-for="b in g.bits" :key="b.m" class="pm-check">
            <input type="checkbox" :checked="(bits & b.m) !== 0" @change="toggleBit(b.m)" />
            <span>{{ b.l }}</span>
          </label>
        </div>
      </div>
      <div class="pm-oct">
        <span class="pm-oct-l">{{ tt('sfp.permValue') }}</span>
        <input class="pm-oct-i" :value="octalText" spellcheck="false" maxlength="4" @input="onOctalInput" />
        <span class="pm-sym">{{ symbolic }}</span>
      </div>
      <label v-if="hasDir" class="pm-recur">
        <input v-model="recursive" type="checkbox" />
        <span>{{ tt('sfp.permRecursive') }}</span>
      </label>
      <p v-if="error" class="pm-err">{{ error }}</p>
      <div class="pm-foot">
        <button class="pm-btn ghost" @click="emit('close', { applied: false })">{{ tt('sfp.cancel') }}</button>
        <button class="pm-btn primary" :disabled="busy" @click="apply">
          {{ busy ? tt('sfp.applying') : tt('sfp.ok') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- permission (chmod) dialog ---- */
.pm-target {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-faint);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pm-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 14px;
}

.pm-col {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 9px 10px;
}

.pm-col-h {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 7px;
}

.pm-check {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 0;
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
}

.pm-check input,
.pm-recur input {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.pm-oct {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.pm-oct-l {
  font-size: 12.5px;
  color: var(--text-dim);
}

.pm-oct-i {
  width: 84px;
  height: 32px;
  padding: 0 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 15px;
  letter-spacing: 0.14em;
  outline: none;
}

.pm-oct-i:focus {
  border-color: var(--accent);
}

.pm-sym {
  flex: 1;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}

.pm-recur {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 12.5px;

  color: var(--text-dim);
  cursor: pointer;
}

</style>
