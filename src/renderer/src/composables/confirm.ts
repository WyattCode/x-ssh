import { reactive } from 'vue'
import { useI18n } from '../lib/i18n'

const { t } = useI18n()

export interface ConfirmOptions {
  title?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState extends Required<ConfirmOptions> {
  open: boolean
  message: string
  resolve: ((v: boolean) => void) | null
}

interface Queued {
  message: string
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}

// Shared, app-wide state driving a single ConfirmDialog host. Incoming
// confirm() calls while a dialog is open are queued and shown in order, so a
// burst of confirmations (e.g. deleting many files on a shortcut) never
// silently discards (answers "no") the ones triggered while the first was up.
const state = reactive<ConfirmState>({
  open: false,
  message: '',
  title: '',
  confirmText: t('confirm.ok'),
  cancelText: t('confirm.cancel'),
  danger: false,
  resolve: null
})
const queue: Queued[] = []

function present(item: Queued): void {
  state.message = item.message
  state.title = item.opts.title ?? ''
  state.confirmText = item.opts.confirmText ?? t('confirm.ok')
  state.cancelText = item.opts.cancelText ?? t('confirm.cancel')
  state.danger = item.opts.danger ?? false
  state.open = true
}

export function useConfirm(): {
  state: ConfirmState
  confirm: (message: string, opts?: ConfirmOptions) => Promise<boolean>
  answer: (v: boolean) => void
} {
  function confirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
    return new Promise<boolean>((res) => {
      const item: Queued = { message, opts, resolve: res }
      if (state.open && state.resolve) queue.push(item)
      else {
        state.resolve = res
        present(item)
      }
    })
  }
  function answer(v: boolean): void {
    const r = state.resolve
    state.resolve = null
    state.open = false
    r?.(v)
    const next = queue.shift()
    if (next) {
      state.resolve = next.resolve
      present(next)
    }
  }
  return { state, confirm, answer }
}
