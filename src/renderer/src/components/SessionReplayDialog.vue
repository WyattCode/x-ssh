<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'

const dialogEl = ref<HTMLElement>()
useFocusTrap(dialogEl, () => store.replayOpen)
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import Icon from './Icon.vue'

const store = useSessions()
// Mounted for the app's lifetime and shown by its own v-if, so an onMounted
// focus ran once at startup with no element and never again.
watch(
  () => store.replayOpen,
  (open) => {
    if (open) nextTick(() => dialogEl.value?.focus())
  }
)
const { t } = useI18n()

const path = ref('')
const content = ref('')
const loading = ref(false)
const err = ref('')

async function openFile(): Promise<void> {
  const r = await window.api.local.pickFile()
  if (!r.ok || r.canceled || !r.path) return
  err.value = ''
  await load(r.path)
}

async function load(p: string): Promise<void> {
  path.value = p
  loading.value = true
  const r = await window.api.local.readText(p)
  loading.value = false
  if (!r.ok) {
    err.value =
      r.error === 'file-too-large' ? t('sfp.fileTooLarge') : (r.error ?? t('replay.readFail'))
      r.error === 'path-invalid' ? t('sfp.pathInvalid') : (r.error ?? t('replay.readFail'))
    content.value = ''
    return
  }
  content.value = r.content ?? ''
}

watch(
  () => store.replayOpen,
  (open) => {
    if (!open) return
    err.value = ''
  }
)
</script>

<template>
  <div v-if="store.replayOpen" class="rp-overlay" @mousedown.self="store.toggleReplay(false)">
    <div ref="dialogEl" tabindex="-1" class="rp-dialog" @keydown.esc="store.toggleReplay(false)">
      <div class="rp-head">
        <Icon name="file" :size="15" />
        <span class="rp-title">{{ t('replay.title') }}</span>
        <button class="rp-x" :title="t('fileDiff.close')" @click="store.toggleReplay(false)"><Icon name="close" :size="14" /></button>
      </div>
      <div class="rp-body">
        <div class="rp-toolbar">
          <button class="rp-open" @click="openFile">
            <Icon name="folder" :size="14" />{{ t('replay.openFile') }}
          </button>
          <span v-if="path" class="rp-path" :title="path">{{ path }}</span>
        </div>
        <p v-if="loading" class="rp-hint">{{ t('replay.loading') }}</p>
        <p v-if="err" class="rp-err">{{ err }}</p>
        <pre v-if="content" class="rp-view" tabindex="0">{{ content }}</pre>
        <p v-if="!content && !loading && !err" class="rp-hint">{{ t('replay.empty') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rp-overlay {
  position: fixed;
  inset: 0;
  z-index: 119;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rp-dialog {
  width: min(720px, 94vw);
  height: 76vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.rp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.rp-title {
  font-weight: 600;
  font-size: 13px;
}
.rp-x {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
}
.rp-x:hover {
  color: var(--text);
}
.rp-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  gap: 8px;
}
.rp-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rp-open {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 12.5px;
  cursor: pointer;
}
.rp-path {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rp-view {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.rp-hint {
  color: var(--text-faint);
  font-size: 12px;
  margin: 0;
}
.rp-err {
  color: var(--danger);
  font-size: 11.5px;
  margin: 0;
}
</style>
