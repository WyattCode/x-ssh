import { ref, watch } from 'vue'
import { useToast } from './toast'
import { useI18n } from '../lib/i18n'

const DEFAULT = 13
const MIN = 8
const MAX = 32

function initial(): number {
  const n = Number(window.api.prefs.fontSize)
  return n >= MIN && n <= MAX ? n : DEFAULT
}

// Shared, app-wide terminal font size so every session stays in sync.
const size = ref<number>(initial())
/** The size the settings file actually holds; a refused write rolls back to it. */
let persistedSize = size.value

const { toast } = useToast()
const { t } = useI18n()

/** Persists the size; a refused write (corrupt settings, lock, disk) rolls the
 *  UI back so the session never shows a size the next launch would silently revert. */
async function persistSize(v: number): Promise<void> {
  try {
    const r: unknown = await window.api.settings.set('fontSize', v)
    if (r && typeof r === 'object' && (r as { ok?: boolean }).ok === false) {
      throw new Error((r as { error?: string }).error ?? 'fontSize')
    }
    persistedSize = v
  } catch {
    size.value = persistedSize
    toast(t('app.fontSizeFail'), 'error')
  }
}

// The rollback above writes `persistedSize` back into `size`; skip that echo so a
// failing settings file doesn't get a second write (and a second toast) per bump.
watch(size, (v) => {
  if (v !== persistedSize) void persistSize(v)
})

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
