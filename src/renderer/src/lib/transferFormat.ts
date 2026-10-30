/**
 * Formatting and status helpers shared by the transfer UI (SftpDrawer and
 * TransferPanel). Each of these existed twice, in slightly different forms —
 * and one of the pairs disagreed about what "cancelled" even means, which is
 * how a cancelled transfer could be reported as a failure in one view and
 * correctly in the other.
 */
import type { SftpProgress } from '../../../shared/types'

/**
 * The marker main puts in `error` when a transfer was cancelled.
 *
 * This is a *sentinel*, not display text: main writes it, the UI recognises it,
 * and the label shown to the user comes from i18n (`sfp.cancelled`). Matching on
 * a translated string would break the moment either side's wording changed —
 * and it silently did, for English, where the UI said "Cancelled" while main
 * wrote the Chinese literal.
 */
export const CANCELLED_MARKER = '已取消'

/** Predicate over anything carrying a transfer's `error` field. */
export interface Cancellable {
  error?: string
  /** Set by newer main builds; preferred when present. */
  cancelled?: boolean
}

/** True when this transfer was cancelled rather than having failed. */
export function isCancelled(t: Cancellable | null | undefined): boolean {
  if (!t) return false
  // Prefer the explicit flag so the wording of the message is never load-bearing.
  if (t.cancelled !== undefined) return t.cancelled
  return t.error === CANCELLED_MARKER
}

/** Percentage complete, 0–100. A finished job with no byte total reads as done. */
export function pct(t: Pick<SftpProgress, 'total' | 'transferred' | 'done'>): number {
  if (!t.total) return t.done ? 100 : 0
  return Math.min(100, Math.round((t.transferred / t.total) * 100))
}

/**
 * Human-readable byte count, e.g. `1.2 MB`. Whole bytes print without a
 * decimal, so a small file reads `512 B` rather than `512.0 B`.
 */
export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  if (n < 1024) return `${Math.round(n)} B`
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`
}

/** Transfer rate, or '' when too slow to be worth showing. */
export function formatSpeed(bytesPerSec: number | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0.5) return ''
  return `${formatBytes(bytesPerSec)}/s`
}

/**
 * A relative timestamp ("3 min ago"). Takes the translator so the caller's
 * language applies; the wording lives in i18n, not here.
 *
 * The translator parameter is typed loosely on purpose: i18n's own `Vars` type
 * is `string | number`, and spelling it out here would couple this module to it.
 */
export function formatAgo(
  at: number,
  t: (key: string, vars?: never) => string,
  now: number = Date.now()
): string {
  const seconds = Math.floor((now - at) / 1000)
  const tr = t as unknown as (key: string, vars?: Record<string, number>) => string
  if (seconds < 60) return tr('sfp.justNow')
  if (seconds < 3600) return tr('sfp.minAgo', { n: Math.floor(seconds / 60) })
  if (seconds < 86400) return tr('sfp.hrAgo', { n: Math.floor(seconds / 3600) })
  return tr('sfp.dayAgo', { n: Math.floor(seconds / 86400) })
}

/** Maps a machine-readable transfer error code from main to display text.
 *  Unknown errors pass through unchanged. */
export function transferErrorText(
  error: string,
  translate: (key: string, vars?: Record<string, number>) => string
): string {
  const m = /^checksum-mismatch:(\d+)$/.exec(error)
  if (m) return translate('sfp.checksumMismatch', { n: Number(m[1]) })
  return error
}

/** The status label for a running or finished transfer. */
export function transferStatusText(
  t: Partial<Pick<SftpProgress, 'error' | 'done' | 'total' | 'transferred'>> & Cancellable,
  translate: (key: string, vars?: Record<string, number>) => string
): string {
  if (isCancelled(t)) return translate('sfp.cancelled')
  if (t.error) return transferErrorText(t.error, translate)
  if (t.done) return translate('sfp.done')
  return `${pct({ total: t.total ?? 0, transferred: t.transferred ?? 0, done: t.done })}%`
}