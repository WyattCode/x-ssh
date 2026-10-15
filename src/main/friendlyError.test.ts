import { describe, it, expect } from 'vitest'
import { friendlyError, isTransientConnectError, penaltyRetryDelayMs } from './friendlyError'

describe('friendlyError', () => {
  it('names the rate-limit refusal instead of a generic reset', () => {
    expect(friendlyError('Not allowed at this time')).toContain('连接频率限制')
  })
  it('keeps the plain-reset wording when the socket just dies', () => {
    expect(friendlyError('read ECONNRESET')).toBe('连接被服务器重置')
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
