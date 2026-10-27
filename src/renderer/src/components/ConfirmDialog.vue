<script setup lang="ts">
import { watch, nextTick, ref } from 'vue'
import { useFocusTrap } from '../composables/focusTrap'
const trapEl = ref<HTMLElement>()
useFocusTrap(trapEl, () => state.open)
import { useConfirm } from '../composables/confirm'

const { state, answer } = useConfirm()
const okEl = ref<HTMLButtonElement>()
const cancelEl = ref<HTMLButtonElement>()

// Closing removes the focused button from the DOM, and the dialog that raised
// the confirm usually stays open with a keydown.esc listener on its own root —
// so without this, cancelling a confirm leaves focus on <body> and the caller
// stops answering Esc or typing.
let returnFocusEl: HTMLElement | null = null

// Watch the presented item, not `open`: a queued confirm swaps in while `open`
// stays true (answer() and present() run in the same tick), so watching `open`
// missed it and the new — possibly destructive — confirm inherited the focus of
// the previous one, with Enter sitting on its destructive button.
watch(
  () => state.seq,
  () => {
    if (!state.open) return
    if (!returnFocusEl) {
      const active = document.activeElement
      returnFocusEl = active instanceof HTMLElement && active !== document.body ? active : null
    }
    // A destructive confirm must not have Enter land on the destructive
    // button: focus Cancel instead (matching how the host editor keeps its
    // delete action off the primary slot).
    nextTick(() => (state.danger ? cancelEl.value : okEl.value)?.focus())
  },
  { immediate: true }
)

watch(
  () => state.open,
  (open) => {
    if (open) return
    const back = returnFocusEl
    returnFocusEl = null
    // A queued confirm may already be presenting; don't pull focus back to the
    // dialog underneath it.
    nextTick(() => {
      if (!state.open && back?.isConnected) back.focus()
    })
  }
)
</script>

<template>
  <div v-if="state.open" class="overlay" @mousedown.self="answer(false)">
    <div ref="trapEl" tabindex="-1" class="dialog" @keydown.esc="answer(false)">
      <div v-if="state.title" class="title">{{ state.title }}</div>
      <p class="message">{{ state.message }}</p>
      <div class="actions">
        <button ref="cancelEl" class="ghost" @click="answer(false)">{{ state.cancelText }}</button>
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
