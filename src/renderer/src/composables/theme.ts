import { ref, computed, watchEffect } from 'vue'
import type { ThemePref } from '../../../shared/types'

export type ThemeMode = 'light' | 'dark'
export type { ThemePref }

function initialPref(): ThemePref {
  const saved = window.api.prefs.theme
  // Never chosen (or an old build's value) = follow the OS.
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

// The user's choice: follow the OS, or pinned light / dark.
const pref = ref<ThemePref>(initialPref())

// The OS appearance. Main pins nativeTheme.themeSource to the choice (so the
// title bar matches), which pins this media query too — it only tracks the OS
// while the choice is 'system', which is exactly when it's read.
const media = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(media.matches)
media.addEventListener('change', (e) => {
  systemDark.value = e.matches
})

/** What's actually on screen. */
const mode = computed<ThemeMode>(() =>
  pref.value === 'system' ? (systemDark.value ? 'dark' : 'light') : pref.value
)

watchEffect(() => {
  document.documentElement.dataset.theme = mode.value
})

async function setPref(next: ThemePref): Promise<void> {
  if (next === pref.value) return
  try {
    // Main answers with the resolved appearance. Taking it together with the
    // new choice means switching back to 'system' lands on the OS's real
    // setting in one step — the media query only catches up a moment later,
    // and reading it first would flash the pinned theme's colors.
    const { dark } = await window.api.theme.set(next)
    systemDark.value = dark
  } catch {
    /* switch locally anyway; the media query still tracks the OS */
  }
  pref.value = next
}

export function useTheme(): {
  mode: typeof mode
  pref: typeof pref
  setPref: (next: ThemePref) => Promise<void>
} {
  return { mode, pref, setPref }
}
