<script setup lang="ts">
import { watch, nextTick, ref } from 'vue'
import { useConfirm } from '../composables/confirm'

const { state, answer } = useConfirm()
const okEl = ref<HTMLButtonElement>()

watch(
  () => state.open,
  (o) => {
    if (o) nextTick(() => okEl.value?.focus())
  }
)
</script>

<template>
  <div v-if="state.open" class="overlay" @mousedown.self="answer(false)">
    <div class="dialog" @keydown.esc="answer(false)">
      <div v-if="state.title" class="title">{{ state.title }}</div>
      <p class="message">{{ state.message }}</p>
      <div class="actions">
        <button class="ghost" @click="answer(false)">{{ state.cancelText }}</button>
        <button
          ref="okEl"
          class="confirm"
          :class="{ danger: state.danger }"
          @click="answer(true)"
        >
          {{ state.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 200;
}
.dialog {
  width: min(400px, 90vw);
  background-color: color-mix(in srgb, var(--bg-elev) 90%, transparent);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  padding: 20px;
  animation: pop-in 0.15s cubic-bezier(0.2, 0.8, 0.3, 1);
}
.title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}
.message {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-dim);
  word-break: break-word;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.actions button {
  height: 32px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.ghost {
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.ghost:hover {
  background: var(--hover);
  color: var(--text);
  border-color: var(--border-strong);
}
.confirm {
  background: var(--accent);
  color: #fff;
  font-weight: 500;
}
.confirm:hover {
  filter: brightness(1.08);
}
.confirm.danger {
  background: var(--danger);
}
</style>
