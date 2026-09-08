<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useConfirm } from '../composables/confirm'
import { useI18n } from '../lib/i18n'
import { highlight, langFromName } from '../lib/highlight'
import Icon from './Icon.vue'

const { confirm } = useConfirm()
const { t } = useI18n()

const props = defineProps<{
  open: boolean
  sessionId?: string
  path: string
  name: string
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

// Platform modifier key for the save hint (⌘ on macOS, Ctrl elsewhere).
const modKey = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

const content = ref('')
const original = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const taEl = ref<HTMLTextAreaElement>()
const preEl = ref<HTMLPreElement>()
const highlightOn = ref(true)

const dirty = computed(() => content.value !== original.value)

// The language is derived from the file name; a trailing newline/slot keeps the
// highlight layer's last line height matching the textarea's.
const lang = computed(() => langFromName(props.name))
const highlighted = computed(() =>
  content.value.length ? highlight(content.value + ' ', lang.value) : ''
)

function syncScroll(): void {
  if (!taEl.value || !preEl.value) return
  preEl.value.scrollTop = taEl.value.scrollTop
  preEl.value.scrollLeft = taEl.value.scrollLeft
}

watch(
  () => props.open,
  async (o) => {
    if (!o || !props.sessionId) return
    loading.value = true
    error.value = ''
    content.value = ''
    original.value = ''
    const [hl, r] = await Promise.all([
      window.api.settings.get<boolean>('syntaxHighlight'),
      window.api.sftp.readText(props.sessionId, props.path)
    ])
    highlightOn.value = hl !== false
    loading.value = false
    if (r.ok) {
      content.value = r.content ?? ''
      original.value = content.value
    } else {
      error.value = r.error ?? t('ed.loadFail')
    }
  }
)

async function save(): Promise<void> {
  if (!props.sessionId || saving.value || !dirty.value) return
  saving.value = true
  error.value = ''
  const r = await window.api.sftp.writeText(props.sessionId, props.path, content.value)
  saving.value = false
  if (r.ok) {
    original.value = content.value
    emit('saved')
  } else error.value = r.error ?? t('ed.saveFail')
}

async function close(): Promise<void> {
  if (
    dirty.value &&
    !(await confirm(t('ed.unsavedConfirm'), {
      title: t('ed.unsavedTitle'),
      confirmText: t('ed.closeAnyway'),
      danger: true
    }))
  ) {
    return
  }
  emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void save()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    const ta = taEl.value
    if (!ta) return
    const s = ta.selectionStart
    const en = ta.selectionEnd
    content.value = content.value.slice(0, s) + '  ' + content.value.slice(en)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = s + 2
    })
  }
}
</script>

<template>
  <div v-if="open" class="overlay">
    <div class="editor" @keydown="onKeydown">
      <div class="head">
        <div class="titles">
          <span class="name">{{ name }}<span v-if="dirty" class="dot">●</span></span>
          <span class="path">{{ path }}</span>
        </div>
        <div class="actions">
          <button class="save" :disabled="!dirty || saving" @click="save">
            {{ saving ? t('ed.saving') : t('ed.save') }}
          </button>
          <button class="close" :title="t('ed.close')" @click="close"><Icon name="close" :size="15" /></button>
        </div>
      </div>

      <div v-if="loading" class="state">{{ t('ed.loading') }}</div>
      <div v-else-if="error" class="state err">{{ error }}</div>
      <div v-else class="area-wrap">
        <pre v-show="highlightOn" ref="preEl" class="area highlight" aria-hidden="true" v-html="highlighted"></pre>
        <textarea
          ref="taEl"
          v-model="content"
          class="area input"
          :class="{ 'hl-on': highlightOn }"
          spellcheck="false"
          autocomplete="off"
          wrap="off"
          @scroll="syncScroll"
        />
      </div>

      <div class="foot">
        <span>{{ t('ed.chars', { n: content.length }) }}</span>
        <span class="hint">{{ t('ed.saveHint', { mod: modKey }) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4vh 4vw;
  z-index: 120;
}
.editor {
  width: 100%;
  height: 100%;
  max-width: 1000px;
  display: flex;
  flex-direction: column;
  background-color: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.titles {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.name {
  font-size: 13.5px;
  font-weight: 600;
}
.dot {
  color: var(--accent);
  margin-left: 6px;
  font-size: 11px;
}
.path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.save {
  height: 30px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}
.save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
}
.close:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.area-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}
.area {
  margin: 0;
  padding: 14px;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
  tab-size: 2;
  overflow: auto;
  box-sizing: border-box;
}
.area.highlight {
  position: absolute;
  inset: 0;
  color: var(--text);
  pointer-events: none;
  overflow: hidden;
}
.area.highlight .k { color: #c678dd; }
.area.highlight .s { color: #98c379; }
.area.highlight .c { color: var(--text-faint); font-style: italic; }
.area.highlight .n { color: #d19a66; }
.area.highlight .b { color: #61afef; }
.area.highlight .m { color: #e5c07b; }
.area.highlight .p { color: var(--text-faint); }
.area.input {
  position: relative;
  width: 100%;
  height: 100%;
  color: var(--text);
}
.area.input.hl-on {
  color: transparent;
  caret-color: var(--text);
  background: transparent;
  -webkit-text-fill-color: transparent;
}
.area.input.hl-on::selection {
  color: transparent;
}
.state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 13px;
}
.state.err {
  color: var(--danger);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 20px;
  text-align: center;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-faint);
}
.hint .kbd {
  margin: 0 1px;
}
</style>
