import { ref, watchEffect } from 'vue'

export type ThemeMode = 'light' | 'dark'

function initialMode(): ThemeMode {
  const saved = window.api.prefs.theme
  if (saved === 'light' || saved === 'dark') return saved
  // First run: follow the OS preference.
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

// Shared, app-wide reactive theme state.
const mode = ref<ThemeMode>(initialMode())

let applied = false
watchEffect(() => {
  document.documentElement.dataset.theme = mode.value
  // Skip the first run: it would rewrite the value we were just handed.
  if (applied) void window.api.settings.set('theme', mode.value)
  applied = true
})

export function useTheme(): {
  mode: typeof mode
  toggle: () => void
} {
  return {
    mode,
    toggle: () => {
      mode.value = mode.value === 'dark' ? 'light' : 'dark'
    }
  }
}
