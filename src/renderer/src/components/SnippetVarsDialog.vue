<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'
import { useSnippetVars } from '../composables/snippetVars'
import { useI18n } from '../lib/i18n'
import { isImeKey } from '../lib/ime'
import Icon from './Icon.vue'

const { state, submit, cancel } = useSnippetVars()
const { t } = useI18n()

// Tab must stay in the dialog: the command it sends runs in the terminal behind it.
const svEl = ref<HTMLElement>()
useFocusTrap(svEl, () => state.open)

watch(
  () => state.open,
  (open, old) => {
    if (open && !old) {
      nextTick(() => (document.querySelector('.sv-input') as HTMLInputElement | null)?.focus())
    }
  }
)

function onKey(e: KeyboardEvent): void {
  // While an IME is composing, Enter picks a candidate, not "run" — this box
  // exists precisely to type variable values (often Chinese).
  if (isImeKey(e)) return
  if (e.key === 'Enter') submit()
  else if (e.key === 'Escape') cancel()
}
</script>

<template>
  <div v-if="state.open" class="sv-backdrop" @mousedown.self="cancel">
    <section ref="svEl" class="sv" tabindex="-1" @keydown="onKey">
      <header class="sv-head">
        <Icon name="zap" :size="16" class="sv-ico" />
        <span class="sv-title">{{ t('snip.vars') }}</span>
        <button class="sv-x" :title="t('snip.cancel')" @click="cancel"><Icon name="close" :size="15" /></button>
      </header>
      <div class="sv-body">
        <p class="sv-name">{{ state.snippet?.title }}</p>
        <label v-for="v in state.vars" :key="v.name" class="sv-field">
          <span class="sv-label">{{ v.name }}</span>
          <input
            v-model="v.value"
            class="sv-input"
            :class="{ bad: state.error === v.name }"
            :placeholder="v.name"
          />
        </label>
        <p v-if="state.error" class="sv-error">{{ t('snip.varsRequired', { name: state.error }) }}</p>
      </div>
      <footer class="sv-foot">
        <button class="sv-btn ghost" @click="cancel">{{ t('snip.cancel') }}</button>
        <button class="sv-btn primary" @click="submit">{{ t('snip.run') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.sv-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sv {
  width: 380px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.sv-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}
.sv-ico { color: var(--accent); }
.sv-title { flex: 1; font-size: 14px; font-weight: 600; }
.sv-x {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--text-dim); border-radius: 4px; cursor: pointer;
}
.sv-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.sv-x:hover { background: var(--bg-elev-2); color: var(--text); }
.sv-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.sv-name {
  margin: 0; font-size: 12px; color: var(--text-dim);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sv-field { display: flex; flex-direction: column; gap: 4px; }
.sv-label {
  font-family: var(--font-mono); font-size: 11px; color: var(--text-dim);
}
.sv-input.bad {
  border-color: var(--danger);
}
.sv-input {
  font-family: var(--font-mono); font-size: 12px;
  padding: 6px 8px; border-radius: 5px;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
}
.sv-input:focus { outline: none; border-color: var(--accent); }
.sv-foot {
  display: flex; justify-content: flex-end; gap: 8px; padding: 12px;
  border-top: 1px solid var(--border);
}
.sv-btn {
  padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg-elev); color: var(--text);
}
.sv-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
</style>
