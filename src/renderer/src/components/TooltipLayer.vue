<script setup lang="ts">
import { reactive, ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { splitTip } from '../lib/tooltipText'
import { shouldDismissTooltip } from '../lib/tooltipDismiss'

// A single global tooltip host. It intercepts the native `title` tooltip for
// every element (via delegated mouseover on the document), suppresses the OS
// tooltip (by temporarily clearing the attribute), and renders a styled,
// bordered tooltip anchored to the element — matching the app's look instead of
// the platform's plain yellow box.
const state = reactive({ visible: false, text: '', x: 0, y: 0 })
const tipEl = ref<HTMLElement>()
/** Label and shortcut apart: the shortcut is drawn as a key chip. */
const parts = computed(() => splitTip(state.text))

let hovered: HTMLElement | null = null
let originalTitle: string | null = null
// Hover delay before the tooltip appears, so it doesn't pop on a transient
// pass-through. The native title is suppressed immediately (on entry) so the
// OS tooltip can never appear alongside our delayed one.
let showTimer: number | null = null
const SHOW_DELAY = 600

// While an element is hovered its `title` is held here, not on the element.
// If Vue re-renders the binding meanwhile (a toggle whose label changes on
// click), it writes the new text back onto the element: take that as the new
// title — update the tip, keep suppressing the native one. Without this,
// release() restored the text captured on entry, and since Vue believes the
// attribute already holds the new value it never corrects it: the stale label
// stuck until the next change (the theme button kept saying "switch to light").
let titleWatch: MutationObserver | null = null
function watchTitle(el: HTMLElement): void {
  titleWatch = new MutationObserver(() => {
    const next = el.getAttribute('title')
    if (next === null) return // our own removal
    originalTitle = next
    el.removeAttribute('title')
    state.text = next
    if (!next) state.visible = false
    else if (state.visible) void place(el)
  })
  titleWatch.observe(el, { attributes: true, attributeFilter: ['title'] })
}

function clearShowTimer(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

/** Restores the previous element's title and clears tooltip state. */
function release(): void {
  clearShowTimer()
  // Before restoring: disconnect() also drops queued records, so putting the
  // title back below can't be mistaken for a re-render.
  titleWatch?.disconnect()
  titleWatch = null
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
  // A host row in the rail: beside it, over the terminal side. Below it the tip lay on top of the
  // next host, which is the very thing the user is about to move to.
  if (el.closest('.rail-host') && r.right + 8 + box.width <= vw - 8) {
    state.x = r.right + 8
    state.y = Math.max(8, Math.min(r.top + r.height / 2 - box.height / 2, vh - box.height - 8))
    return
  }
  let x = r.left + r.width / 2 - box.width / 2
  let y = r.bottom + 6
  // Keep the tooltip on screen; flip above the element when it would overflow.
  x = Math.max(8, Math.min(x, vw - box.width - 8))
  if (y + box.height > vh - 8) y = r.top - box.height - 6
  state.x = x
  state.y = Math.max(8, y)
}

function onOver(e: MouseEvent): void {
  const target = e.target as Element | null
  const el = target?.closest?.('[title]') as HTMLElement | null
  // The hovered element's own title is held back while its tip is up, so a child of it
  // resolves to the titled element OUTSIDE it. That is still the hovered one, not a switch:
  // without this, moving onto a button's icon inside a titled row gave the row's tip again
  // (the row's "side by side" over the "more" button).
  if (hovered && target && hovered.contains(target) && (!el || el.contains(hovered))) return
  if (!el || el === hovered) return
  const text = el.getAttribute('title') || ''
  if (!text) return
  // Drop the previous element first, then suppress this one's native title
  // immediately (so it can never flash) before scheduling the delayed show.
  release()
  hovered = el
  originalTitle = el.getAttribute('title')
  el.removeAttribute('title')
  watchTitle(el)
  state.text = text
  state.visible = false
  clearShowTimer()
  showTimer = window.setTimeout(() => {
    showTimer = null
    if (!hovered || !state.text) return
    state.visible = true
    void place(hovered)
  }, SHOW_DELAY)
}
function onOut(e: MouseEvent): void {
  const to = e.relatedTarget as Node | null
  if (hovered && to && hovered.contains(to)) return
  release()
}

// Alt-Tab (or the window being hidden) never delivers a mouseout, so a delayed
// or already-visible tip would stick around — and the hovered element's title
// stay stripped — until the pointer came back. Dismiss on either.
function onInactive(): void {
  if (shouldDismissTooltip(document.visibilityState, true)) release()
}
function onVisibility(): void {
  if (shouldDismissTooltip(document.visibilityState, false)) release()
}

// A key press or scroll dismisses the tip, as native tooltips do. It also
// covers the hovered element disappearing under the pointer (a shortcut
// switching pages hides it) — no mouseout ever arrives for that.
onMounted(() => {
  document.addEventListener('mouseover', onOver, true)
  document.addEventListener('mouseout', onOut, true)
  window.addEventListener('resize', release)
  window.addEventListener('keydown', release, true)
  window.addEventListener('wheel', release, { capture: true, passive: true })
  window.addEventListener('blur', onInactive)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  document.removeEventListener('mouseover', onOver, true)
  document.removeEventListener('mouseout', onOut, true)
  window.removeEventListener('resize', release)
  window.removeEventListener('keydown', release, true)
  window.removeEventListener('wheel', release, { capture: true } as EventListenerOptions)
  window.removeEventListener('blur', onInactive)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div v-if="state.visible" ref="tipEl" class="tip" :style="{ left: state.x + 'px', top: state.y + 'px' }">
    {{ parts.label }}<kbd v-if="parts.key">{{ parts.key }}</kbd>
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
  color: var(--text);
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
.tip kbd {
  margin-left: 8px;
  padding: 0 5px;
  font: inherit;
  font-size: 11px;
  color: var(--text-faint);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
}
</style>
