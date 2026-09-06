<script setup lang="ts">
import { useToast } from '../composables/toast'
import Icon from './Icon.vue'

const { list, dismiss } = useToast()
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="t in list"
        :key="t.id"
        class="toast"
        :class="t.type"
        @click="dismiss(t.id)"
      >
        <Icon :name="t.type === 'error' ? 'alert-triangle' : t.type === 'success' ? 'check' : 'info'" :size="15" />
        <span class="msg">{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 52px;
  right: 16px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 360px;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--bg-elev) 92%, transparent);
  backdrop-filter: blur(12px) saturate(1.1);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow);
  font-size: 13px;
  color: var(--text);
  pointer-events: auto;
  cursor: pointer;
  animation: slide-in 0.18s ease;
  animation: toast-in 0.16s ease-out;
}
.toast.error {
  border-color: var(--danger);
  color: var(--danger);
}
.toast.success {
  border-color: var(--ok);
  color: var(--ok);
}
.toast .msg {
  word-break: break-word;
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.16s, transform 0.16s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
