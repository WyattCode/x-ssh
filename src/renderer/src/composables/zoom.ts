import { ref, computed, type ComputedRef, type Ref } from 'vue'

/**
 * UI zoom, backed by Electron's webFrame zoom *level* (each step is ×1.2). A
 * reactive `factor` (1.2^level) is exposed so the macOS tab bar can
 * counter-scale itself and stay glued to the native (unscaled) traffic lights.
 * Persistence matches the app: restored from window.api.prefs.zoom, saved
 * (debounced) to settings.json.
 */
const MIN = -3
const MAX = 5
const clamp = (l: number): number => Math.max(MIN, Math.min(MAX, l))
const initial = Number(window.api.prefs?.zoom)
const level = ref(Number.isNaN(initial) ? 0 : clamp(initial))
let saveTimer: ReturnType<typeof setTimeout> | null = null

export interface ZoomApi {
  level: Ref<number>
  factor: ComputedRef<number>
  setLevel: (l: number) => void
  bump: (delta: number) => void
  reset: () => void
  apply: () => void
}

export function useZoom(): ZoomApi {
  const factor = computed(() => 1.2 ** level.value)
  function setLevel(l: number): void {
    level.value = clamp(l)
    window.api.zoom.set(level.value)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void window.api.settings.set('zoom', level.value), 300)
  }
  return {
    level,
    factor,
    setLevel,
    bump: (delta: number) => setLevel(level.value + delta),
    reset: () => setLevel(0),
    apply: () => window.api.zoom.set(level.value)
  }
}
