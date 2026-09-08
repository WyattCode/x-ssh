<script setup lang="ts">
import { reactive, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'

// A single global tooltip host. It intercepts the native `title` tooltip for
// every element (via delegated mouseover on the document), suppresses the OS
// tooltip (by temporarily clearing the attribute), and renders a styled,
// bordered tooltip anchored to the element — matching the app's look instead of
// the platform's plain yellow box.
const state = reactive({ visible: false, text: '', x: 0, y: 0 })
const tipEl = ref<HTMLElement>()

let hovered: HTMLElement | null = null
let originalTitle: string | null = null
// Hover delay before the tooltip appears, so it doesn't pop on a transient
// pass-through. The native title is suppressed immediately (on entry) so the
// OS tooltip can never appear alongside our delayed one.
let showTimer: number | null = null
const SHOW_DELAY = 600

function clearShowTimer(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

/** Restores the previous element's title and clears tooltip state. */
function release(): void {
  clearShowTimer()
  if (hovered && originalTitle !== null && hovered.isConnected) {
    hovered.setAttribute('title', originalTitle)
  }
  hovered = null
  originalTitle = null
  state.visible = false
}

async function place(el: HTMLElement): Promise<void> {
  await nextTick()
  const box = tipEl.value?.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (!box) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x = r.left + r.width / 2 - box.width / 2
  let y = r.bottom + 7
  // Keep the tooltip on screen; flip above the element when it would overflow.
  x = Math.max(8, Math.min(x, vw - box.width - 8))
  if (y + box.height > vh - 8) y = r.top - box.height - 7
  state.x = x
  state.y = Math.max(8, y)
}

function onOver(e: MouseEvent): void {
  const el = (e.target as Element | null)?.closest?.('[title]') as HTMLElement | null
  if (!el || el === hovered) return
  const text = el.getAttribute('title') || ''
  if (!text) return
  // Drop the previous element first, then suppress this one's native title
  // immediately (so it can never flash) before scheduling the delayed show.
  release()
  hovered = el
  originalTitle = el.getAttribute('title')
  el.removeAttribute('title')
  state.text = text
  state.visible = false
  clearShowTimer()
  showTimer = window.setTimeout(() => {
    showTimer = null
    if (!hovered) return
    state.visible = true
    void place(hovered)
  }, SHOW_DELAY)
}
function onOut(e: MouseEvent): void {
  const to = e.relatedTarget as Node | null
  if (hovered && to && hovered.contains(to)) return
  release()
}

onMounted(() => {
  document.addEventListener('mouseover', onOver, true)
  document.addEventListener('mouseout', onOut, true)
  window.addEventListener('resize', release)
})
onBeforeUnmount(() => {
  document.removeEventListener('mouseover', onOver, true)
  document.removeEventListener('mouseout', onOut, true)
  window.removeEventListener('resize', release)
})
</script>

<template>
  <div v-if="state.visible" ref="tipEl" class="tip" :style="{ left: state.x + 'px', top: state.y + 'px' }">
    {{ state.text }}
  </div>
</template>

<style scoped>
.tip {
  position: fixed;
  z-index: 1000;
  pointer-events: none;
  max-width: min(320px, 78vw);
  padding: 4px 9px;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-dim);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 7px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
</style>
