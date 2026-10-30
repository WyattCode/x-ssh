import type { KeyErrorCode } from '../../../shared/types'

/**
 * Turns a `keys:*` IPC failure into a translated message.
 *
 * Main reports the failures it can name as a stable `code` (see KeyErrorCode)
 * instead of a hard-coded Chinese string, so the renderer can translate them
 * for whatever language the UI is in. Anything else keeps the message main
 * already made friendly.
 */
export function keyErrorMessage(
  r: { code?: KeyErrorCode | string; error?: string },
  t: (k: string, vars?: Record<string, string | number>) => string
): string {
  switch (r.code) {
    case 'invalid-key':
      return t('host.keyInvalid')
    case 'bad-id':
      return t('host.keyBadId')
    case 'no-pubkey':
      return t('host.keyNoPub')
    case 'not-ready':
      return t('host.keyNotReady')
    default:
      return r.error || t('host.keyOpFail')
  }
}
