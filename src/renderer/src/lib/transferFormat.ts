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
export const CANCELLED_MARKER = 'cancelled'

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
  // Older main builds wrote the Chinese literal; keep recognising it.
  return t.error === CANCELLED_MARKER || t.error === '已取消'
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
 * Display name for a transfer job. Main may emit a machine token instead of a
 * file name (a sync job reports `sync`), so the known tokens are translated and
 * anything else — a real file name — passes through untouched.
 */
export function formatTransferName(
  name: string,
  translate: (key: string, vars?: Record<string, string | number>) => string
): string {
  if (name === 'sync' || name === '同步') return translate('sfp.sync')
  return name
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

/**
 * Remaining time for a running transfer, e.g. `~12s` or `~3 min`. Returns ''
 * when the rate or the remaining byte count is unknown, or when less than a
 * second is left (a countdown that reads "0s" is noise).
 *
 * Like [formatAgo], the translator is typed loosely so this module stays
 * decoupled from i18n's `Vars` type.
 */
export function formatEta(
  remainingBytes: number | undefined,
  bytesPerSec: number | undefined,
  t: (key: string, vars?: never) => string
): string {
  if (!remainingBytes || remainingBytes <= 0) return ''
  if (!bytesPerSec || bytesPerSec <= 0.5) return ''
  const seconds = remainingBytes / bytesPerSec
  if (!Number.isFinite(seconds) || seconds < 1) return ''
  const tr = t as unknown as (key: string, vars?: Record<string, number>) => string
  if (seconds < 60) return tr('sfp.etaSec', { n: Math.round(seconds) })
  return tr('sfp.etaMin', { n: Math.ceil(seconds / 60) })
/** Map main's transfer error codes to i18n. Unknown strings pass through. */
export function formatTransferError(
  err: string,
  translate: (key: string, vars?: Record<string, string | number>) => string
): string {
  if (err === CANCELLED_MARKER || err === '已取消') return translate('sfp.cancelled')
  if (err === 'sync-list-failed') return translate('sfp.syncListFailed')
  const ff = /^files-failed:(\d+)$/.exec(err)
  if (ff) return translate('sfp.filesFailed', { n: Number(ff[1]) })
  const cm = /^checksum-mismatch:(\d+)$/.exec(err)
  if (cm) return translate('sfp.checksumMismatch', { n: Number(cm[1]) })
  return err
}

/** The status label for a running or finished transfer. */
export function transferStatusText(
  t: Partial<Pick<SftpProgress, 'error' | 'done' | 'total' | 'transferred'>> & Cancellable,
  translate: (key: string) => string
): string {
  if (isCancelled(t)) return translate('sfp.cancelled')
  if (t.error) {
    // Same loose-typing cast as formatAgo: the caller's translator may or may
    // not accept vars, and the code mapping needs them.
    const tr = translate as unknown as (key: string, vars?: Record<string, string | number>) => string
    return formatTransferError(t.error, tr)
  }
  if (t.done) return translate('sfp.done')
  return `${pct({ total: t.total ?? 0, transferred: t.transferred ?? 0, done: t.done })}%`
}

/**
 * Short status label for a finished transfer's history badge. The error body is
 * shown on its own wrapping line (it can be long), so this never returns it.
 */
export function histStatusLabel(
  status: string,
  translate: (key: string) => string
): string {
  if (status === 'cancelled') return translate('sfp.cancelled')
  if (status === 'error') return translate('sfp.failed')
  return translate('sfp.done')
}
