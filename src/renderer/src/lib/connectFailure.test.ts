import { describe, it, expect } from 'vitest'
import { connectFailureMessage, sessionEventMessage } from './connectFailure'

/** Stands in for i18n: echoes the key and inlines any vars. */
const t = (key: string, vars?: Record<string, string | number>): string =>
  vars ? `${key}:${JSON.stringify(vars)}` : key

const ctx = { viaJump: false, keyWhere: 'a.example.com' }

describe('connectFailureMessage', () => {
  it('names the target host for a refused key', () => {
    expect(connectFailureMessage({ code: 'host_key_unknown' }, ctx, t)).toBe(
      'app.keyUnknownMsg:{"host":"a.example.com"}'
    )
    expect(connectFailureMessage({ code: 'host_key_changed' }, ctx, t)).toBe(
      'app.keyChangedMsg:{"host":"a.example.com"}'
    )
  })

  it('names the jump host when that hop is the one refused', () => {
    // The fingerprint belongs to the hop that presented it, so both the wording
    // and the host it names change — mixing them up would send the user to
    // trust the wrong machine.
    const jumpCtx = { viaJump: true, keyWhere: 'bastion.example.com:2222' }
    expect(connectFailureMessage({ code: 'host_key_unknown' }, jumpCtx, t)).toBe(
      'app.keyUnknownJumpMsg:{"host":"bastion.example.com:2222"}'
    )
    expect(connectFailureMessage({ code: 'host_key_changed' }, jumpCtx, t)).toBe(
      'app.keyChangedJumpMsg:{"host":"bastion.example.com:2222"}'
    )
  })

  it('maps each plain code to its own key', () => {
    const expected: Record<string, string> = {
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
      userVerifyCanceled: 'hello.canceled',
      userVerifyFailed: 'hello.failed',
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
    for (const [code, key] of Object.entries(expected)) {
      expect(connectFailureMessage({ code }, ctx, t), code).toBe(key)
    }
  })

  it('localizes the channel-closed marker in both spellings', () => {
    // Older main builds sent the Chinese literal; both must reach the same key
    // rather than leaking raw text into the pane.
    expect(connectFailureMessage({ error: 'channel-closed' }, ctx, t)).toBe('app.channelClosed')
    expect(connectFailureMessage({ error: '已关闭' }, ctx, t)).toBe('app.channelClosed')
  })

  it('passes an unmapped message through', () => {
    // main already ran it through friendlyError, so it is user-facing.
    expect(connectFailureMessage({ error: 'Connection refused' }, ctx, t)).toBe(
      'Connection refused'
    )
  })

  it('falls back when there is neither a known code nor a message', () => {
    expect(connectFailureMessage({}, ctx, t)).toBe('app.connectFail')
    expect(connectFailureMessage({ code: 'some-future-code' }, ctx, t)).toBe('app.connectFail')
  })

  it('prefers the mapped wording over a raw error on a known code', () => {
    // A code is the authoritative classification; the raw error is a debugging
    // string and must not win over it.
    expect(connectFailureMessage({ code: 'locked', error: 'raw detail' }, ctx, t)).toBe(
      'app.locked'
    )
  })
})

describe('sessionEventMessage', () => {
  it('localizes the machine codes main emits on a status event', () => {
    expect(sessionEventMessage('connection-lost', t)).toBe('app.sessionLost')
    expect(sessionEventMessage('channel-closed', t)).toBe('app.channelClosed')
    expect(sessionEventMessage('已关闭', t)).toBe('app.channelClosed')
    expect(sessionEventMessage('host_key_unknown', t)).toBe('app.keyUntrusted')
    expect(sessionEventMessage('host_key_changed', t)).toBe('app.keyChanged')
  })

  it('passes any other message through — main already made it friendly', () => {
    expect(sessionEventMessage('Socket handshake failed', t)).toBe('Socket handshake failed')
  })

  it('falls back to the generic drop message when there is none', () => {
    expect(sessionEventMessage(undefined, t)).toBe('app.sessionLost')
  })
})