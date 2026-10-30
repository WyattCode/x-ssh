import type { ConnectResult } from '../../../shared/types'

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Codes whose wording is fixed regardless of which hop failed. */
const PLAIN_CODES: Record<string, string> = {
  jump_needs_password: 'app.jumpNeedsPassword',
  jump_needs_key: 'app.jumpNeedsKey',
  jump_missing: 'app.jumpMissing',
  locked: 'app.locked',
  'no-private-key': 'app.noPrivateKey',
  needs_key: 'app.needsKey',
  needs_password: 'app.needsPassword',
  needs_passphrase: 'app.needsPassphrase',
  bad_passphrase: 'app.badPassphrase',
  auth_failed: 'app.authFailed',
  secrets_load_failed: 'app.secretsLoadFail',
  'jump-forward-timeout': 'app.jumpForwardTimeout',
  'jump-connect-failed': 'app.jumpConnectFailed',
  'proxy-handshake-timeout': 'app.proxyHandshakeTimeout',
  'socks5-version': 'app.socks5Version',
  'socks5-auth-required': 'app.socks5AuthRequired',
  'socks5-auth-failed': 'app.socks5AuthFailed',
  'socks5-connect-failed': 'app.socks5ConnectFailed',
  'socks5-addr-type': 'app.socks5AddrType',
  'http-proxy-failed': 'app.httpProxyFailed'
}

/**
 * The message to show on a pane whose connect attempt failed.
 *
 * This used to be one deeply nested ternary in the store. Two rewrites of it
 * were merged into each other and left the file unparseable, which is exactly
 * what a lookup table makes impossible — adding a code is one line, and every
 * code is tested below.
 *
 * Host-key codes are the only ones that need context: the fingerprint belongs
 * to the jump host when the rejection came from that hop, so the wording (and
 * the host it names) differs.
 */
export function connectFailureMessage(
  result: Pick<ConnectResult, 'code' | 'error'>,
  ctx: { viaJump: boolean; keyWhere: string },
  t: Translate
): string {
  const code = result.code

  if (code === 'host_key_unknown' || code === 'host_key_changed') {
    const suffix = code === 'host_key_unknown' ? 'Unknown' : 'Changed'
    const key = ctx.viaJump ? `app.key${suffix}JumpMsg` : `app.key${suffix}Msg`
    return t(key, { host: ctx.keyWhere })
  }

  const plain = code ? PLAIN_CODES[code] : undefined
  if (plain) return t(plain)

  // 'channel-closed' is written as an error string rather than a code by the
  // main process; both spellings have been seen.
  if (result.error === 'channel-closed' || result.error === '已关闭') {
    return t('app.channelClosed')
  }

  // Anything unmapped keeps main's message, which is already user-facing.
  return result.error ?? t('app.connectFail')
}