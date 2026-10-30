<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'
const trapEl = ref<HTMLElement>()
useFocusTrap(trapEl, () => store.tmuxOpen)
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { useToast } from '../composables/toast'
import Icon from './Icon.vue'

const store = useSessions()
const { t } = useI18n()
const { toast } = useToast()

const sessions = ref<string[]>([])
const newName = ref('')
const busy = ref(false)
const inputEl = ref<HTMLInputElement>()

function sid(): string | undefined {
  return store.activePane?.sshSessionId
}

async function list(): Promise<void> {
  const id = sid()
  if (!id) return
  try {
    sessions.value = await window.api.ssh.tmuxList(id)
  } catch {
    sessions.value = []
    toast(t('tmux.listFail'), 'error')
  }
}

async function attach(name: string): Promise<void> {
  const id = sid()
  if (!id) return
  if (busy.value) return
  if (!id || busy.value) return
  // Attaching types into the terminal: show it.
  store.setPage('terminal')
  busy.value = true
  try {
    const r = await window.api.ssh.tmuxAttach(id, name)
    if (!r.ok) {
      toast(t('tmux.attachFail'), 'error')
      return
    }
    store.toggleTmux(false)
  } finally {
    busy.value = false
  }
}

function submit(): void {
  const n = newName.value.trim()
  if (n) attach(n)
}

watch(
  () => store.tmuxOpen,
  async (open) => {
    if (!open) return
    newName.value = ''
    busy.value = false
    sessions.value = []
    await list()
    nextTick(() => inputEl.value?.focus())
  }
)
</script>

<template>
  <div v-if="store.tmuxOpen" class="tm-overlay" @mousedown.self="store.toggleTmux(false)">
    <div ref="trapEl" tabindex="-1" class="tm-dialog" @keydown.esc="store.toggleTmux(false)">
      <div class="tm-head">
        <Icon name="terminal" :size="15" />
        <span class="tm-title">{{ t('pal.tmux') }}</span>
        <button class="tm-x" :title="t('fileDiff.close')" @click="store.toggleTmux(false)"><Icon name="close" :size="14" /></button>
      </div>
      <div class="tm-body">
        <p v-if="!sessions.length" class="tm-empty">{{ t('tmux.empty') }}</p>
        <button v-for="s in sessions" :key="s" class="tm-sess" :disabled="busy" @click="attach(s)">
          <Icon name="terminal" :size="13" />
          <span>{{ s }}</span>
        </button>
        <form class="tm-new" @submit.prevent="submit">
          <input
            ref="inputEl"
            v-model="newName"
            :placeholder="t('tmux.newPh')"
            spellcheck="false"
            :disabled="busy"
          />
          <button class="tm-btn" type="submit" :disabled="busy || !newName.trim()">
            {{ t('tmux.attachCreate') }}
          </button>
        </form>
        <p class="tm-hint">{{ t('tmux.hint') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tm-overlay {
  position: fixed;
  inset: 0;
  z-index: 118;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.tm-dialog {
  width: min(380px, 90vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.tm-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.tm-title {
  font-weight: 600;
  font-size: 13px;
}
.tm-x {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
}
.tm-x:hover {
  color: var(--text);
}
.tm-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}
.tm-empty {
  color: var(--text-faint);
  font-size: 12px;
}
.tm-sess {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.tm-sess:hover {
  background: var(--accent-soft);
}
.tm-sess:disabled {
  opacity: 0.55;
  cursor: default;
}
.tm-new {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.tm-new input {
  flex: 1;
  padding: 7px 9px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
}
.tm-btn {
  padding: 7px 12px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--accent-contrast);
  cursor: pointer;
  font-size: 13px;
}
.tm-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.tm-hint {
  color: var(--text-faint);
  font-size: 11px;
  margin: 0;
}
</style>
