<script setup lang="ts">
/**
 * Read-only directory comparison: which entries exist only on one side, and
 * which differ in size. Extracted from SftpDrawer's drawer template; it owns
 * its own scan so the drawer only has to decide when to open it.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'

const dialogEl = ref<HTMLElement>()
useFocusTrap(dialogEl, () => true) // mounted only while the parent shows it
onMounted(() => nextTick(() => dialogEl.value?.focus()))
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import Icon from './Icon.vue'

const props = defineProps<{
  sessionId: string
  /** Starting values for the two path fields. */
  localPath: string
  remotePath: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const { t: tt } = useI18n()
const { toast } = useToast()

const local = ref(props.localPath)
const remote = ref(props.remotePath)
const busy = ref(false)
const err = ref('')
const done = ref(false)
const onlyLocal = ref<string[]>([])
const onlyRemote = ref<string[]>([])
const sizeDiff = ref<string[]>([])

const canRun = computed(() => !!local.value && !!remote.value && !busy.value)

/** The three result groups, empty ones dropped. */
const groups = computed(() =>
  [
    { label: tt('dirDiff.onlyRemote'), items: onlyRemote.value, cls: 'rr', icon: 'download' },
    { label: tt('dirDiff.onlyLocal'), items: onlyLocal.value, cls: 'll', icon: 'upload' },
    { label: tt('dirDiff.sizeDiff'), items: sizeDiff.value, cls: 'df', icon: 'diff' }
  ].filter((g) => g.items.length)
)

const identical = computed(
  () => done.value && !onlyLocal.value.length && !onlyRemote.value.length && !sizeDiff.value.length
)

async function run(): Promise<void> {
  if (!canRun.value) return
  busy.value = true
  err.value = ''
  try {
    const r = await window.api.sftp.diffDirs(props.sessionId, local.value, remote.value)
    if (!r.ok) {
      // Dialog-local err alone is lost on dismiss — toast like PermDialog (#104).
      const msg = r.error ?? tt('dirDiff.fail')
      err.value = msg
      toast(msg, 'error')
      done.value = false
      return
    }
    onlyLocal.value = r.onlyLocal ?? []
    onlyRemote.value = r.onlyRemote ?? []
    sizeDiff.value = r.sizeDiff ?? []
    done.value = true
  } catch (e) {
    const msg = (e as Error).message
    err.value = msg
    toast(msg, 'error')
    done.value = false
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pm-overlay" @mousedown.self="emit('close')">
    <div ref="dialogEl" tabindex="-1" class="pm-dialog" @keydown.esc="emit('close')">
      <div class="pm-head">
        <span>{{ tt('sfp.dirDiff') }}</span>
        <button class="pm-x" :title="tt('sfp.close')" @click="emit('close')"><Icon name="close" /></button>
      </div>
      <label class="dialog-field">
        <span>{{ tt('sfp.syncLocal') }}</span>
        <input v-model="local" spellcheck="false" />
      </label>
      <label class="dialog-field">
        <span>{{ tt('sfp.syncRemote') }}</span>
        <input v-model="remote" spellcheck="false" />
      </label>
      <p v-if="!local || !remote" class="pm-err">{{ tt('sfp.syncPathsRequired') }}</p>
      <div v-if="done" class="dd-body">
        <div v-if="identical" class="dd-empty">{{ tt('dirDiff.same') }}</div>
        <div v-for="g in groups" :key="g.cls" class="dd-group">
          <div class="dd-h">
            <Icon :name="g.icon" :size="13" />
            <span>{{ g.label }}</span>
            <em>{{ g.items.length }}</em>
          </div>
          <div v-for="f in g.items" :key="f" class="dd-row" :title="f">{{ f }}</div>
        </div>
      </div>
      <p v-if="err" class="pm-err">{{ err }}</p>
      <div class="pm-foot">
        <button class="pm-btn ghost" @click="emit('close')">{{ tt('sfp.close') }}</button>
        <button class="pm-btn primary" :disabled="!canRun" @click="run">
          {{ busy ? tt('dirDiff.scanning') : tt('dirDiff.run') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dd-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 42vh;
  overflow: auto;
  padding-right: 2px;
}
.dd-empty {
  color: var(--text-faint);
  font-size: 12.5px;
  margin: 0;
}
.dd-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dd-h {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
  padding-bottom: 2px;
}
.dd-h em {
  font-style: normal;
  color: var(--text-faint);
  opacity: 0.8;
}
.dd-row {
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 0;
}
</style>
