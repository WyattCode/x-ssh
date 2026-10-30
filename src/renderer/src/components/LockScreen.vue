<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'
const trapEl = ref<HTMLElement>()
useFocusTrap(trapEl, () => true)
import { useSessions } from '../stores/sessions'
import { useI18n } from '../lib/i18n'
import { isImeKey } from '../lib/ime'
import Icon from './Icon.vue'

const store = useSessions()
const { t } = useI18n()

const pass = ref('')
const error = ref('')
const busy = ref(false)
const inputEl = ref<HTMLInputElement>()

function focus(): void {
  nextTick(() => inputEl.value?.focus())
}

// This screen is a full-window gate: the passphrase field has to be ready for
// typing the moment it appears, not after the user clicks it.
onMounted(focus)

// A wrong-attempt message should lift as soon as the user starts retyping,
// rather than lingering until the next submit.
function onInput(): void {
  if (error.value) error.value = ''
}

async function unlock(): Promise<void> {
  if (busy.value) return
  const v = pass.value
  if (!v) {
    error.value = t('lock.passReq')
    focus()
    return
  }
  busy.value = true
  error.value = ''
  try {
    const ok = await store.unlockApp(v)
    if (ok) {
      pass.value = ''
      // Secret availability changed — refresh saved-password flags.
      await store.loadHosts()
      // Reconnect any tabs that were restored but deferred while locked.
      store.connectPendingAfterUnlock()
    } else {
      error.value = t('lock.wrong')
      focus()
    }
  } finally {
    busy.value = false
  }
}

const onKey = (e: KeyboardEvent): void => {
  // The Enter that commits an IME candidate belongs to the input method, not to
  // us: unlocking on it would submit a passphrase that is still half-composed.
  if (isImeKey(e)) return
  if (e.key === 'Enter') void unlock()
}
</script>

<template>
  <div class="lock-overlay" @mousedown.self="focus">
    <div ref="trapEl" tabindex="-1" class="lock-card">
      <div class="lock-icon"><Icon name="lock" :size="26" /></div>
      <h1 class="lock-title">{{ t('lock.title') }}</h1>
      <p class="lock-sub">{{ t('lock.desc') }}</p>
      <input
        ref="inputEl"
        v-model="pass"
        type="password"
        class="lock-input"
        :placeholder="t('lock.placeholder')"
        autocomplete="off"
        @keydown="onKey"
        @input="onInput"
      />
      <p v-if="error" class="lock-error">{{ error }}</p>
      <button class="lock-btn" :disabled="busy" @click="unlock">
        <Icon name="unlock" :size="15" />
        <span>{{ busy ? t('lock.unlocking') : t('lock.unlock') }}</span>
      </button>
      <p class="lock-hint">{{ t('lock.hint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.lock-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
.lock-card {
  width: min(360px, 90vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px;
  border-radius: var(--radius);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.lock-icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  margin-bottom: 2px;
}
.lock-title {
  font-size: 17px;
  font-weight: 600;
}
.lock-sub {
  font-size: 12.5px;
  color: var(--text-dim);
  text-align: center;
  line-height: 1.6;
}
.lock-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  font-size: 14px;
  text-align: center;
}
.lock-input:focus {
  border-color: var(--accent);
}
.lock-error {
  font-size: 12px;
  color: var(--danger);
}
.lock-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 38px;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 13.5px;
  font-weight: 500;
}
.lock-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}
.lock-btn:disabled {
  opacity: 0.6;
}
.lock-hint {
  font-size: 11px;
  color: var(--text-faint);
  text-align: center;
}
</style>
