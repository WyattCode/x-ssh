import { describe, it, expect } from 'vitest'
import { connectNeedsPrivateKey } from './keyAuth'
import type { ConnectParams } from '../shared/types'

function params(over: Partial<ConnectParams> = {}): ConnectParams {
  return {
    host: 'example.com',
    port: 22,
    username: 'user',
    auth: 'password',
    ...over
  } as ConnectParams
}

describe('connectNeedsPrivateKey', () => {
  it('is false for password auth without a jump host', () => {
    expect(connectNeedsPrivateKey(params({ auth: 'password' }))).toBe(false)
  })

  it('is true when the primary hop uses key auth', () => {
    expect(connectNeedsPrivateKey(params({ auth: 'key' }))).toBe(true)
  })

  it('is true when only the jump host uses key auth', () => {
    expect(
      connectNeedsPrivateKey(
        params({ auth: 'password', jump: { host: 'bastion', port: 22, username: 'u', auth: 'key' } as ConnectParams['jump'] })
      )
    ).toBe(true)
  })

  it('is false when neither hop uses key auth', () => {
    expect(
      connectNeedsPrivateKey(
        params({ auth: 'password', jump: { host: 'bastion', port: 22, username: 'u', auth: 'password' } as ConnectParams['jump'] })
      )
    ).toBe(false)
  })

  it('is true when both hops use key auth', () => {
    expect(
      connectNeedsPrivateKey(
        params({ auth: 'key', jump: { host: 'bastion', port: 22, username: 'u', auth: 'key' } as ConnectParams['jump'] })
      )
    ).toBe(true)
  })
})
