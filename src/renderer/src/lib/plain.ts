import { toRaw } from 'vue'

/**
 * Recursively unwraps Vue reactive proxies into a plain, cloneable value.
 *
 * Anything crossing an Electron IPC boundary must survive structured clone, and
 * a Proxy does not: `invoke` fails with "An object could not be cloned", the
 * main process never sees the call, and the caller gets an error that looks
 * exactly like a real failure. The host editor hit this — it passed
 * `props.host.os` (a Pinia proxy) straight through, so every save of a host
 * that already had an OS icon failed with a bare "保存失败" while nothing was
 * written to disk.
 *
 * Dates, arrays and nested objects are preserved; functions and other
 * non-cloneable values are dropped rather than allowed to poison the payload.
 */
export function toPlain<T>(value: T): T {
  const raw = toRaw(value)
  if (raw === null || typeof raw !== 'object') return raw as T
  if (raw instanceof Date) return raw as T
  if (Array.isArray(raw)) return raw.map((v) => toPlain(v)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    const v = toPlain((raw as Record<string, unknown>)[key])
    // A function cannot be cloned; omitting it keeps the rest of the object
    // usable instead of failing the whole call.
    if (typeof v !== 'function') out[key] = v
  }
  return out as T
}
