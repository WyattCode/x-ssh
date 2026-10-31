import { describe, it, expect } from 'vitest'
import {
  friendlyError,
  isAuthConnectError,
  isTransientConnectError,
  penaltyRetryDelayMs,
  passphraseConnectCode
} from './friendlyError'

describe('friendlyError', () => {
  it('names the rate-limit refusal instead of a generic reset', () => {
    expect(friendlyError('Not allowed at this time')).toBe('rate-limited')
  })
  it('keeps the plain-reset wording when the socket just dies', () => {
    expect(friendlyError('read ECONNRESET')).toBe('conn-reset')
  })
  it('passes through kebab-case machine codes', () => {
    expect(friendlyError('passphrase-empty')).toBe('passphrase-empty')
    expect(friendlyError('app-locked')).toBe('app-locked')
    expect(friendlyError('connection-lost')).toBe('connection-lost')
  })

  it('never returns Chinese prose', () => {
    // The point of the change: main must not decide wording, because it does
    // not know the UI language. Everything is either a code or a tagged raw.
    const inputs = [
      'All configured authentication methods failed',
      'connect ECONNREFUSED 10.0.0.1:22',
      'getaddrinfo ENOTFOUND nope',
      'Timed out while waiting for handshake',
      'No such file',
      'Permission denied',
      'ENOSPC: no space left on device',
      'something nobody has ever seen',
      ''
    ]
    for (const m of inputs) {
      expect(/[\u3400-\u9fff]/.test(friendlyError(m)), m).toBe(false)
    }
  })

  it('tags an unrecognized error so the original text survives', () => {
    // terse uses a code that matches no table row, so the original text is all
    // the user can get — keep it rather than replacing it with "操作失败".
    expect(friendlyError('tar: unrecognized option --xattrs')).toBe(
      'raw-error:tar: unrecognized option --xattrs'
    )
    expect(friendlyError('')).toBe('unknown-error')
  })

  it('still recognizes the node disk-full error', () => {
    expect(friendlyError('ENOSPC: no space left on device')).toBe('fs-no-space')
  })

  it('does not double-tag an error that is already tagged', () => {
    const once = friendlyError('weird thing happened')
    expect(friendlyError(once)).toBe(once)
  })

  it('checks handshake before the generic timeout branch', () => {
    // "Timed out while waiting for handshake" contains "timed out"; the more
    // specific wording has to win or the user is told the wrong thing.
    expect(friendlyError('Timed out while waiting for handshake')).toBe('handshake-timeout')
    expect(friendlyError('connect ETIMEDOUT')).toBe('connect-timeout')
  })

  it('maps the file-operation failures distinctly', () => {
    expect(friendlyError('No such file')).toBe('fs-not-found')
    expect(friendlyError('Permission denied')).toBe('fs-permission')
    expect(friendlyError('File already exists')).toBe('fs-exists')
    expect(friendlyError('Failure')).toBe('fs-op-failed')
  })
})

describe('isTransientConnectError', () => {
  it('marks network conditions a retry can ride out', () => {
    for (const m of [
      'read ECONNRESET',
      'connect ETIMEDOUT 192.168.1.101:22',
      'Timed out while waiting for handshake',
      'Not allowed at this time',
      'connect EHOSTUNREACH',
    ]) {
      expect(isTransientConnectError(m), m).toBe(true)
    }
  })
  it('never marks auth or host-key failures transient', () => {
    // 阴性对照:重试这些只会锤账号或把指纹卡顶掉。
    for (const m of [
      'All configured authentication methods failed',
      'Host key verification failed',
      'Encrypted private key detected',
    ]) {
      expect(isTransientConnectError(m), m).toBe(false)
    }
  })
})

describe('penaltyRetryDelayMs', () => {
  it('outlasts the penalty window for rate-limit refusals only', () => {
    expect(penaltyRetryDelayMs('Not allowed at this time')).toBe(30_000)
    expect(penaltyRetryDelayMs('read ECONNRESET')).toBeUndefined()
    expect(penaltyRetryDelayMs(undefined)).toBeUndefined()
  })
})

describe('isAuthConnectError', () => {
  it('flags credential / key failures', () => {
    for (const m of [
      'All configured authentication methods failed',
      'Encrypted private key detected',
      'Cannot parse privateKey: Error: malformed',
      '认证失败:用户名、密码或密钥不正确',
    ]) {
      expect(isAuthConnectError(m), m).toBe(true)
      expect(isTransientConnectError(m), m).toBe(false)
    }
  })
  it('does not flag plain network errors', () => {
    expect(isAuthConnectError('read ECONNRESET')).toBe(false)
    expect(isAuthConnectError('connect ETIMEDOUT')).toBe(false)
  })
})

describe('passphraseConnectCode', () => {
  it('flags missing passphrase', () => {
    expect(
      passphraseConnectCode('Encrypted private key detected, but no passphrase given', false)
    ).toBe('needs_passphrase')
    expect(
      passphraseConnectCode('Encrypted OpenSSH private key detected, but no passphrase given', false)
    ).toBe('needs_passphrase')
  })
  it('flags wrong passphrase when one was supplied', () => {
    expect(
      passphraseConnectCode('OpenSSH key integrity check failed -- bad passphrase?', true)
    ).toBe('bad_passphrase')
  })
  it('treats ambiguous Chinese with no passphrase as needs', () => {
    expect(passphraseConnectCode('私钥无法解析,或密钥的密码短语不正确', false)).toBe('needs_passphrase')
    expect(passphraseConnectCode('私钥无法解析,或密钥的密码短语不正确', true)).toBe('bad_passphrase')
  })
  it('ignores plain network / auth-methods failures', () => {
    expect(passphraseConnectCode('All configured authentication methods failed', false)).toBeUndefined()
    expect(passphraseConnectCode('read ECONNRESET', true)).toBeUndefined()
  })
})
