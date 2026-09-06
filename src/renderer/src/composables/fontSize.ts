import { ref, watch } from 'vue'

const DEFAULT = 13
const MIN = 8
const MAX = 32

function initial(): number {
  const n = Number(window.api.prefs.fontSize)
  return n >= MIN && n <= MAX ? n : DEFAULT
}

// Shared, app-wide terminal font size so every session stays in sync.
const size = ref<number>(initial())

watch(size, (v) => void window.api.settings.set('fontSize', v))

export function useFontSize(): {
  size: typeof size
  bump: (delta: number) => void
  reset: () => void
} {
  return {
    size,
    bump: (delta: number) => {
      size.value = Math.min(MAX, Math.max(MIN, size.value + delta))
    },
    reset: () => {
      size.value = DEFAULT
    }
  }
}
