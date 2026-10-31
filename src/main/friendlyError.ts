// i18n-allow-file: 文件里的中文全部出现在"识别旧版中文报错"的匹配条件里（passphraseConnectCode /
// isAuthConnectError 要能认出已经被翻成中文的旧字符串），没有任何一处是输出给用户的文案。
/**
 * Maps raw ssh2 / Node network / SFTP error strings to stable machine codes
 * that the renderer translates (see `renderer/src/lib/mainError.ts`).
 *
 * It used to return Simplified Chinese prose, which meant an English or
 * Traditional-Chinese UI showed Chinese for anything the renderer did not
 * already have its own code for — every unexpected SFTP/fs error, essentially.
 * Main never draws these strings itself, so returning a code costs nothing and
 * makes the wording follow the `lang` setting.
 *
 * Recognized errors come back as a known code; anything else comes back as
 * `raw-error:<original>` so the renderer can show the original text (English
 * from Node/ssh2 is readable, and losing it would be worse than not localizing).
 */
export function friendlyError(msg: string | undefined): string {
  const raw = msg ?? ''
  // Stable machine codes (kebab-case) are mapped in the renderer; do not rewrite them.
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(raw)) return raw
  if (raw.startsWith(RAW_ERROR_PREFIX)) return raw
  const m = raw.toLowerCase()
  const has = (s: string): boolean => m.includes(s)

  // ---- authentication ----
  if (has('all configured authentication methods failed') || has('authentication methods failed'))
    return 'auth_failed'
  if (has('keyboard-interactive')) return 'auth-interactive'
  if (has('passphrase') || has('cannot parse privatekey') || has('integrity check') || has('unsupported key'))
    return 'key-unreadable'

  // ---- connection / network ----
  // Ordered before the generic reset/timeout branches: "Not allowed at this
  // time" also matches nothing else, but a handshake timeout must not be
  // reported as a plain connect timeout.
  if (has('not allowed at this time')) return 'rate-limited'
  if (has('timed out while waiting for handshake') || has('handshake')) return 'handshake-timeout'
  if (has('etimedout') || has('timed out')) return 'connect-timeout'
  if (has('econnrefused')) return 'conn-refused'
  if (has('enotfound') || has('getaddrinfo')) return 'dns-failed'
  if (has('ehostunreach')) return 'host-unreachable'
  if (has('enetunreach')) return 'net-unreachable'
  if (has('econnreset')) return 'conn-reset'
  if (has('econnaborted')) return 'conn-aborted'
  if (has('eacces') || has('eaccess')) return 'access-denied'
  if (has('epipe')) return 'conn-closed'

  // ---- SFTP file operations ----
  if (has('no such file')) return 'fs-not-found'
  if (has('permission denied')) return 'fs-permission'
  if (has('not a directory')) return 'fs-not-dir'
  if (has('is a directory')) return 'fs-is-dir'
  if (has('already exists')) return 'fs-exists'
  if (has('no space left')) return 'fs-no-space'
  if (has('quota')) return 'fs-quota'
  if (m === 'failure' || has('sftp error') || has('sftp failure')) return 'fs-op-failed'

  // Unknown: keep the original text, tagged so the renderer can tell it apart
  // from a code and show it verbatim (or translate a known Chinese mapping).
  return raw ? `${RAW_ERROR_PREFIX}${raw}` : 'unknown-error'
}

/** Marker for "this is not a code, it is the original error text". */
export const RAW_ERROR_PREFIX = 'raw-error:'

/**
 * Whether a raw connect error is a transient network condition worth retrying
 * as-is (reset, timeout, unreachable): the auto-retry rides these out. Auth
 * failures and refused host keys are deliberately not transient — retrying
 * those either hammers accounts or keeps the fingerprint card from showing.
 */
export function isTransientConnectError(raw: string | undefined): boolean {
  const m = (raw ?? '').toLowerCase()
  const has = (s: string): boolean => m.includes(s)
  return (
    has('econnreset') ||
    has('etimedout') ||
    has('timed out') ||
    has('handshake') ||
    has('econnaborted') ||
    has('epipe') ||
    has('enetunreach') ||
    has('ehostunreach') ||
    has('not allowed at this time')
  )
}

/** Passphrase / encrypted-key parse failures (not generic auth_failed). */
export type PassphraseConnectCode = 'needs_passphrase' | 'bad_passphrase'

/**
 * When `raw` is an encrypted-key / passphrase error, return a stable code.
 * `hadPassphrase` distinguishes "none given" vs "wrong" when the message is
 * ambiguous (Android uses the same rule for KeyEncrypted).
 * Accepts already-mapped Chinese so a second pass stays stable.
 */
export function passphraseConnectCode(
  raw: string | undefined,
  hadPassphrase: boolean
): PassphraseConnectCode | undefined {
  const m = (raw ?? '').toLowerCase()
  const zh = raw ?? ''
  const isPass =
    m.includes('no passphrase given') ||
    m.includes('encrypted private key') ||
    m.includes('encrypted private openssh') ||
    m.includes('encrypted openssh') ||
    m.includes('encrypted ppk') ||
    m.includes('integrity check') ||
    m.includes('bad passphrase') ||
    (m.includes('passphrase') && (m.includes('privatekey') || m.includes('private key') || m.includes('cannot parse'))) ||
    m.includes('cannot parse privatekey') ||
    zh.includes('私钥无法解析') ||
    zh.includes('密码短语不正确') ||
    zh.includes('密碼短語')
  if (!isPass) return undefined
  if (m.includes('no passphrase given') || !hadPassphrase) return 'needs_passphrase'
  return 'bad_passphrase'
}

/**
 * Whether a raw connect error is a credential / key failure (wrong password,
 * rejected key, unreadable or passphrase-protected private key, interactive
 * auth). Android's ReconnectPolicy already treats these as permanent — never
 * auto-retried — and the desktop loop must match: retrying a rotated password
 * or a bad key only hammers the account (and feeds fail2ban). Accepts the
 * already-mapped Chinese wording too, so re-entry through friendlyError() is
 * safe.
 */
export function isAuthConnectError(raw: string | undefined): boolean {
  const m = (raw ?? '').toLowerCase()
  const has = (s: string): boolean => m.includes(s)
  return (
    has('authentication methods failed') ||
    has('all configured authentication') ||
    has('keyboard-interactive') ||
    has('passphrase') ||
    has('cannot parse privatekey') ||
    has('integrity check') ||
    has('unsupported key') ||
    has('encrypted private key') ||
    has('认证失败') ||
    has('私钥无法解析') ||
    has('未选择私钥')
  )
}

/**
 * How long to wait before the automatic first retry when the refusal came from
 * the server's connection-rate limiting: each refused attempt is itself a
 * pre-auth connection, so retrying within the penalty window only feeds it —
 * the delay has to outlast the penalty decay instead.
 */
export function penaltyRetryDelayMs(raw: string | undefined): number | undefined {
  return (raw ?? '').toLowerCase().includes('not allowed at this time') ? 30_000 : undefined
}
