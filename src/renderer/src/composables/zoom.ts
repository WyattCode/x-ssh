import { ref, computed } from 'vue'

// Chromium zoom levels: factor = 1.2 ^ level. Half-level steps give the
// familiar 100 → 110 → 120 … ladder; the range is 58 % … 249 %.
export const ZOOM_MIN = -3
export const ZOOM_MAX = 5
export const ZOOM_STEP = 0.5

export function zoomFactor(level: number): number {
  return Math.pow(1.2, level)
}
export function zoomPercent(level: number): number {
  return Math.round(zoomFactor(level) * 100)
}

const level = ref(window.api.zoom.get())
/** The on-screen percentage pill; shown on every user zoom, fades by itself. */
const hudOpen = ref(false)

let hideTimer: ReturnType<typeof setTimeout> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let hovering = false

function scheduleHide(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  // Stays up while the pointer is on it (its − / + / reset are clickable).
  if (!hovering) hideTimer = setTimeout(() => (hudOpen.value = false), 1500)
}

function setZoom(next: number): void {
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next))
  window.api.zoom.set(clamped)
  level.value = clamped
  hudOpen.value = true
  scheduleHide()
  // Apply immediately but debounce the persist: a Ctrl+wheel gesture fires many
  // notches, and each write is a full re-read+rewrite of settings.json that a
  // second instance could be reading at the same moment.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.settings.set('zoom', clamped), 300)
}

/** Startup: re-apply the saved level quietly (no pill, no write-back). */
function restore(saved: number): void {
  window.api.zoom.set(saved)
  level.value = saved
}

function setHover(on: boolean): void {
  hovering = on
  if (on && hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  } else if (!on && hudOpen.value) scheduleHide()
}

export function useZoom(): {
  level: typeof level
  percent: import('vue').ComputedRef<number>
  hudOpen: typeof hudOpen
  setZoom: (next: number) => void
  bump: (delta: number) => void
  reset: () => void
  restore: (saved: number) => void
  setHover: (on: boolean) => void
} {
  return {
    level,
    percent: computed(() => zoomPercent(level.value)),
    hudOpen,
    setZoom,
    bump: (delta) => setZoom(level.value + delta),
    reset: () => setZoom(0),
    restore,
    setHover
  }
}
