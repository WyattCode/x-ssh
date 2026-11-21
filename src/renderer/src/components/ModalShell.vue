<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../lib/i18n'
import { useFocusTrap } from '../composables/focusTrap'
import Icon from './Icon.vue'

// A dialog in the middle of the window: settings and port forwarding open here
// (a sheet sliding in from the side is a phone's habit, not a desktop's). Esc or a
// click on the dimmed area closes it; Tab stays inside.
const props = defineProps<{ open: boolean; width?: number; tall?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()
const panel = ref<HTMLElement>()
useFocusTrap(panel, () => props.open)

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !props.open) return
  // A dialog or menu above this one takes Esc first (this dialog itself is aria-modal).
  const others = document.querySelectorAll('.overlay, .pm-overlay, [aria-modal="true"], .rec-capture')
  if ([...others].some((el) => el !== panel.value && !panel.value?.contains(el))) return
  const tgt = e.target as HTMLElement | null
  // In a field Esc first leaves the field (so a number box does not trap it); the
  // next Esc closes the dialog.
  if (tgt && /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName)) {
    tgt.blur()
    panel.value?.focus()
    return
  }
  emit('close')
}
watch(
  () => props.open,
  (o) => {
    if (o) {
      window.addEventListener('keydown', onKey)
      void nextTick(() => panel.value?.focus())
    } else window.removeEventListener('keydown', onKey)
  },
  { immediate: true }
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="modal">
    <div v-if="open" class="modal-layer" @mousedown.self="emit('close')">
      <div
        ref="panel"
        class="modal"
        :class="{ tall }"
        :style="{ width: `min(${width ?? 720}px, calc(100vw - 48px))` }"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <button class="modal-x" :title="t('sheet.close')" :aria-label="t('sheet.close')" @click="emit('close')">
          <Icon name="close" :size="16" />
        </button>
        <div class="modal-body"><slot /></div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  background: rgba(0, 0, 0, 0.6);
}
.modal {
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 140px);
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.07), 0 28px 80px rgba(0, 0, 0, 0.7);
  outline: none;
}
/* A clear margin above and below: the dialog floats, it does not hang off the tab bar. */
.modal.tall {
  height: min(780px, calc(100vh - 140px));
}
.modal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius);
}
.modal-x {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--text-dim);
  border-radius: var(--radius-sm);
}
.modal-x:hover {
  color: var(--text);
  background: var(--hover);
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s var(--ease);
}
.modal-enter-active .modal {
  animation: pop-in 0.3s cubic-bezier(0.3, 1.35, 0.5, 1);
}
.modal-leave-active .modal {
  transition: transform 0.14s var(--ease);
  transform: scale(0.985);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
