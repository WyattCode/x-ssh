/**
 * Translation table for the stable codes the main process returns instead of
 * prose (`src/main/friendlyError.ts` and the hand-written codes around it).
 *
 * This exists because the same code reaches the UI through three doors — a
 * failed connect (`connectFailureMessage`), a session status event
 * (`sessionEventMessage`), and an SFTP/fs operation (`sftpErrorText`). Before
 * this table each door had its own partial mapping, so a code added for one
 * path showed up untranslated in the other two.
 *
 * Keys are i18n dictionary keys; the text itself lives in `i18n.ts` so the
 * three languages stay symmetric under `lint:i18n`.
 */
export const MAIN_ERROR_KEYS: Record<string, string> = {
  // authentication
  auth_failed: 'err.authFailed',
  'auth-interactive': 'err.authInteractive',
  'key-unreadable': 'err.keyUnreadable',

  // connection / network
  'rate-limited': 'err.rateLimited',
  'handshake-timeout': 'err.handshakeTimeout',
  'connect-timeout': 'err.connectTimeout',
  'conn-refused': 'err.connRefused',
  'dns-failed': 'err.dnsFailed',
  'host-unreachable': 'err.hostUnreachable',
  'net-unreachable': 'err.netUnreachable',
  'conn-reset': 'err.connReset',
  'conn-aborted': 'err.connAborted',
  'conn-closed': 'err.connClosed',
  'access-denied': 'err.accessDenied',

  // file operations
  'fs-not-found': 'err.fsNotFound',
  'fs-permission': 'err.fsPermission',
  'fs-not-dir': 'err.fsNotDir',
  'fs-is-dir': 'err.fsIsDir',
  'fs-exists': 'err.fsExists',
  'fs-no-space': 'err.fsNoSpace',
  'fs-quota': 'err.fsQuota',
  'fs-op-failed': 'err.fsOpFailed',

  // nothing useful to say
  'unknown-error': 'err.unknown'
}

/** Prefix main uses for an error it could not classify (`raw-error:<text>`). */
const RAW_PREFIX = 'raw-error:'

type Translate = (key: string, vars?: Record<string, string | number>) => string

/**
 * Text for one main-process error string.
 *
 * A known code becomes localized text. `raw-error:` yields the original text
 * after it — Node and ssh2 messages are English and specific, which beats a
 * generic "操作失败". A bare kebab code that this table does not know is
 * returned as-is rather than swallowed: that is the signal that a new code was
 * added in main and needs a row here.
 */
export function mainErrorText(err: string | undefined, t: Translate): string | undefined {
  if (!err) return undefined
  if (err.startsWith(RAW_PREFIX)) {
    const original = err.slice(RAW_PREFIX.length).trim()
    return original || t('err.unknown')
  }
  const key = MAIN_ERROR_KEYS[err]
  return key ? t(key) : err
}

/** Whether `err` is a code this table can localize. Used by the coverage test. */
export function isTranslatedCode(err: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAIN_ERROR_KEYS, err)
}