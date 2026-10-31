import { formatTransferError } from './transferFormat'
import { mainErrorText } from './mainError'

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Codes with a fixed wording, independent of which operation failed. */
const SFTP_ERROR_KEYS: Record<string, string> = {
  'session-missing': 'sfp.sessionMissing',
  'session-gone': 'sfp.sessionGone',
  'remote-timeout': 'sfp.remoteTimeout',
  'unsafe-filename': 'sfp.unsafeFilename',
  'extract-failed': 'sfp.extractFail',
  'sync-list-failed': 'sfp.syncListFailed',
  'window-not-ready': 'app.windowNotReady'
}

/**
 * Turn a machine error code from the main process into UI text.
 *
 * Main reports SFTP failures as stable codes rather than prose so the renderer
 * can localize them; anything it does not recognize is already user-facing
 * (friendlyError) and is passed through, with the caller's fallback key used
 * only when there is no message at all.
 *
 * This lived inline in SftpDrawer.vue, where it was reachable only through the
 * component and therefore untestable — the kind of mapping that rots quietly
 * when a code is added to main and forgotten here.
 */
export function sftpErrorText(
  err: string | undefined,
  fallbackKey: string,
  t: Translate
): string {
  if (err) {
    const fixed = SFTP_ERROR_KEYS[err]
    if (fixed) return t(fixed)

    // "delete-failed:3" — some of the batch failed; 3 is the count.
    const del = /^delete-failed:(\d+)$/.exec(err)
    if (del) return t('sfp.deletePartial', { n: Number(del[1]) })

    // "files-failed:3" carries its own wording (see transferFormat).
    if (err.startsWith('files-failed:')) return formatTransferError(err, t)

    // Codes from friendlyError (fs-permission, conn-reset, …) and the tagged
    // raw-error:<text> carry. Before this, an unrecognized fs error reached an
    // English UI as Chinese prose written by the main process.
    const mapped = mainErrorText(err, t)
    if (mapped) return mapped

    return err
  }
  return t(fallbackKey)
}