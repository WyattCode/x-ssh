import type { DownloadItem, TransferHistoryItem } from '../../../shared/types'
import { posixJoin } from '../../../shared/fsUtils'

/**
 * Pure helpers for the SFTP transfer-history panel: deciding which actions are
 * offered (retry / reveal) and building the payload a retry re-sends. Kept out
 * of the component so the logic is unit-testable and shared.
 */

/** A failed download can be retried into its original local destination. */
export function canRetryHistory(h: TransferHistoryItem): boolean {
  return (
    h.direction === 'down' &&
    h.status === 'error' &&
    !!h.localDir &&
    (!!h.items?.length || h.isDir !== undefined)
  )
}

/** Builds the remote entries a retry should re-download into h.localDir. */
export function buildRetryItems(h: TransferHistoryItem): DownloadItem[] {
  if (h.items?.length) return h.items
  return [
    {
      path: h.remotePath ?? posixJoin(h.remoteDir ?? '/', h.name),
      name: h.name,
      isDir: !!h.isDir
    }
  ]
}

/** A finished transfer can be revealed in the OS file manager. */
export function canRevealHistory(h: TransferHistoryItem): boolean {
  if (h.status !== 'done') return false
  return h.direction === 'up' ? !!h.localPaths?.length : !!h.localDir
}
