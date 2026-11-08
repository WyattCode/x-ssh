import { appendFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Voice-input diagnostics log.
 *
 * Off unless `<dir>/ime-trace.enabled` exists AND was touched in the last 24
 * hours: the trace holds dictated text, so a flag file somebody forgot about
 * must not keep recording forever. Lines are appended through one promise chain
 * so they land in the order they were reported — the order of IME events is the
 * whole point of the log — and the file is cut back when it passes 1 MB.
 */
export const TRACE_FLAG = 'ime-trace.enabled'
export const TRACE_LOG = 'ime-trace.log'
export const TRACE_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const TRACE_MAX_BYTES = 1_000_000
/** How long a "flag present?" answer is reused, so a burst of events costs one stat. */
const CACHE_MS = 2000

export interface ImeTrace {
  /** Whether tracing is switched on right now. */
  enabled(): Promise<boolean>
  /** Appends one line (ignored while disabled). */
  write(line: string): void
  /** Resolves when every line written so far has reached the disk. */
  flush(): Promise<void>
}

export function createImeTrace(dir: string, now: () => number = Date.now): ImeTrace {
  const flag = join(dir, TRACE_FLAG)
  const log = join(dir, TRACE_LOG)
  let cache = { at: -Infinity, on: false }
  let chain: Promise<void> = Promise.resolve()

  async function enabled(): Promise<boolean> {
    const t = now()
    if (t - cache.at < CACHE_MS) return cache.on
    let on = false
    try {
      const s = await stat(flag)
      on = t - s.mtimeMs < TRACE_MAX_AGE_MS
    } catch {
      on = false
    }
    cache = { at: t, on }
    return on
  }

  function write(line: string): void {
    chain = chain.then(async () => {
      try {
        if (!(await enabled())) return
        const size = await stat(log).then((s) => s.size, () => 0)
        if (size > TRACE_MAX_BYTES) await writeFile(log, '')
        await appendFile(log, line.slice(0, 4000) + '\n')
      } catch {
        // Diagnostics must never disturb the session they describe.
      }
    })
  }

  return { enabled, write, flush: () => chain }
}
