import { ref, computed } from 'vue'
import { shouldReleaseZoomHover } from '../lib/zoomHud'
import { useI18n } from '../lib/i18n'
import { useToast } from './toast'
import {
  ZOOM_DEFAULT_PCT,
  ZOOM_MAX_PCT,
  ZOOM_MIN_PCT,
  levelToFactor,
  levelToPercent,
  percentToLevel,
  snapLevel,
  snapPercent,
  stepPercent
} from '../../../shared/zoom'

// The app zoom moves in whole 10 % steps (50 … 120 … 250); see shared/zoom.ts. The
// settings file keeps Chromium's level (factor = 1.2 ^ level), so older saves still load.
export { ZOOM_DEFAULT_PCT, ZOOM_MAX_PCT, ZOOM_MIN_PCT }

export function zoomFactor(level: number): number {
  return levelToFactor(level)
}
export function zoomPercent(level: number): number {
  return levelToPercent(level)
}

const { t } = useI18n()
const { toast } = useToast()

// Whatever the window holds right now, moved onto the ladder (the preload already did
// this at startup; this only guards a level that arrived some other way).
const level = ref(snapLevel(window.api.zoom.get()))
/** The level the settings file actually holds; a refused write rolls back to it. */
let persistedLevel = level.value
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

/** Zoom to a percentage (snapped to a multiple of 10 inside 50…250). */
function setPercent(pct: number): void {
  const next = percentToLevel(snapPercent(pct))
  if (Math.abs(next - level.value) < 1e-9) {
    // Already there (the end of the ladder, or reset at the default): just show the pill.
    hudOpen.value = true
    scheduleHide()
    return
  }
  window.api.zoom.set(next)
  level.value = next
  hudOpen.value = true
  scheduleHide()
  // Apply immediately but debounce the persist: a Ctrl+wheel gesture fires many
  // notches, and each write is a full re-read+rewrite of settings.json that a
  // second instance could be reading at the same moment.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void persistZoom(next), 300)
}

/** Persists the level; a refused write rolls the UI back so the session never
 *  shows a zoom the next launch would silently revert. */
async function persistZoom(next: number): Promise<void> {
  try {
    const r: unknown = await window.api.settings.set('zoom', next)
    if (r && typeof r === 'object' && (r as { ok?: boolean }).ok === false) {
      throw new Error((r as { error?: string }).error ?? 'zoom')
    }
    persistedLevel = next
  } catch {
    window.api.zoom.set(persistedLevel)
    level.value = persistedLevel
    toast(t('app.zoomFail'), 'error')
  }
}

/** Startup: re-apply the saved level quietly (no pill, no write-back). */
function restore(saved: number): void {
  const snapped = snapLevel(saved)
  window.api.zoom.set(snapped)
  level.value = snapped
  persistedLevel = snapped
}

function setHover(on: boolean): void {
  hovering = on
  if (on && hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  } else if (!on && hudOpen.value) scheduleHide()
}

/**
 * Clear sticky hover so the HUD can auto-hide after blur/hide.
 *
 * `hovering` is normally cleared by the pill's `mouseleave`. When the window is
 * blurred (Alt-Tab) or the document is hidden while the pointer sits on the
 * pill, that event never fires and `hudOpen` would stay true forever — the
 * auto-hide timer is never armed again. Called from the window/document
 * listeners registered below.
 */
export function releaseHudHover(): void {
  hovering = false
  if (hudOpen.value) scheduleHide()
}

// Registered once, at module init (renderer only). A blur or a hidden document
// means the pointer's `mouseleave` will never arrive.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('blur', () => {
    if (shouldReleaseZoomHover(document.visibilityState, true)) releaseHudHover()
  })
  document.addEventListener('visibilitychange', () => {
    if (shouldReleaseZoomHover(document.visibilityState, false)) releaseHudHover()
  })
}

export function useZoom(): {
  level: typeof level
  /** Whole multiple of 10, 50…250. */
  percent: import('vue').ComputedRef<number>
  /** Zoom factor (1.2^level); the macOS tab bar counter-scales by it to stay glued to the native traffic lights. */
  factor: import('vue').ComputedRef<number>
  hudOpen: typeof hudOpen
  setPercent: (pct: number) => void
  /** One 10 % step: +1 larger, -1 smaller. */
  step: (dir: 1 | -1) => void
  reset: () => void
  restore: (saved: number) => void
  setHover: (on: boolean) => void
} {
  const percent = computed(() => zoomPercent(level.value))
  return {
    level,
    percent,
    factor: computed(() => zoomFactor(level.value)),
    hudOpen,
    setPercent,
    step: (dir) => setPercent(stepPercent(percent.value, dir)),
    reset: () => setPercent(ZOOM_DEFAULT_PCT),
    restore,
    setHover
  }
}
