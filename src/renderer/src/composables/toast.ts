import { reactive } from 'vue'

export type ToastType = 'info' | 'error' | 'success'

export interface Toast {
  id: number
  type: ToastType
  message: string
}

const list = reactive<Toast[]>([])
let seq = 0

/** App-wide transient notifications (connection errors, transfer results…). */
export function useToast(): {
  list: Toast[]
  toast: (message: string, type?: ToastType, duration?: number) => void
  dismiss: (id: number) => void
} {
  function dismiss(id: number): void {
    const i = list.findIndex((t) => t.id === id)
    if (i >= 0) list.splice(i, 1)
  }
  function toast(message: string, type: ToastType = 'info', duration = 3200): void {
    const id = ++seq
    list.push({ id, type, message })
    if (duration > 0) setTimeout(() => dismiss(id), duration)
  }
  return { list, toast, dismiss }
}
