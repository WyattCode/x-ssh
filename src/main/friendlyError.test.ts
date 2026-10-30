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
    expect(friendlyError('Not allowed at this time')).toContain('连接频率限制')
  })
  it('keeps the plain-reset wording when the socket just dies', () => {
    expect(friendlyError('read ECONNRESET')).toBe('连接被服务器重置')
  })
  it('passes through kebab-case machine codes', () => {
    expect(friendlyError('passphrase-empty')).toBe('passphrase-empty')
    expect(friendlyError('app-locked')).toBe('app-locked')
    expect(friendlyError('connection-lost')).toBe('connection-lost')
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
