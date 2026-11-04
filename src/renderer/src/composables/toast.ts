import { reactive } from 'vue'

export type ToastType = 'info' | 'error' | 'success'

export interface Toast {
  id: number
  type: ToastType
  message: string
}

const list = reactive<Toast[]>([])
let seq = 0
/** Pending auto-dismiss timers, so a repeated toast can restart its own clock. */
const timers = new Map<number, ReturnType<typeof setTimeout>>()

/** App-wide transient notifications (connection errors, transfer results…). */
export function useToast(): {
  list: Toast[]
  toast: (message: string, type?: ToastType, duration?: number) => void
  dismiss: (id: number) => void
} {
  function dismiss(id: number): void {
    const i = list.findIndex((t) => t.id === id)
    if (i >= 0) list.splice(i, 1)
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }
  function toast(message: string, type: ToastType = 'info', duration = 3200): void {
    // Collapse an identical message into the toast already on screen.
    //
    // Toasts sat in a bare append-only list, so anything that fires on every
    // attempt stacked up: a user re-clicking "信任此密钥并连接" on a failing
    // host once produced eight identical red banners covering the very card
    // they were trying to read. One message, one toast — the newest wins and
    // its clock restarts, so the visible stack reflects distinct problems only.
    const existing = list.find((t) => t.message === message && t.type === type)
    if (existing) {
      const idx = list.indexOf(existing)
      // Move to the end so the most recent occurrence is nearest the corner.
      list.splice(idx, 1)
      list.push(existing)
      const prev = timers.get(existing.id)
      if (prev !== undefined) clearTimeout(prev)
      if (duration > 0) {
        timers.set(
          existing.id,
          setTimeout(() => dismiss(existing.id), duration)
        )
      } else {
        timers.delete(existing.id)
      }
      return
    }
    const id = ++seq
    list.push({ id, type, message })
    if (duration > 0) {
      timers.set(
        id,
        setTimeout(() => dismiss(id), duration)
      )
    }
  }
  return { list, toast, dismiss }
}
