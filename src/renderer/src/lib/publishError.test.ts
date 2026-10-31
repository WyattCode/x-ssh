import { describe, expect, it } from 'vitest'
import { publishErrorText } from './publishError'

const t = (k: string, vars?: Record<string, string | number>): string =>
  vars ? `${k}:${JSON.stringify(vars)}` : k

describe('publishErrorText', () => {
  it('translates every code the main process can return', () => {
    expect(publishErrorText('host-missing', t)).toBe('keyPub.hostMissing')
    expect(publishErrorText('app-locked', t)).toBe('keyPub.appLocked')
    expect(publishErrorText('connect-failed', t)).toBe('keyPub.connectFailed')
    expect(publishErrorText('window-not-ready', t)).toBe('app.windowNotReady')
    expect(publishErrorText('jump-missing', t)).toBe('app.jumpMissing')
    expect(publishErrorText('jump-needs-password', t)).toBe('app.jumpNeedsPassword')
    expect(publishErrorText('jump-needs-key', t)).toBe('app.jumpNeedsKey')
    expect(publishErrorText('no-public-key', t)).toBe('keyPub.noPublicKey')
    expect(publishErrorText('userVerifyCanceled', t)).toBe('hello.canceled')
    expect(publishErrorText('userVerifyFailed', t)).toBe('hello.failed')
    expect(publishErrorText('no-pubkey', t)).toBe('host.keyNoPub')
    expect(publishErrorText('not-ready', t)).toBe('host.keyNotReady')
  })

  it('renders a remote command exit code', () => {
    expect(publishErrorText('remote-exit:2', t)).toBe('keyPub.remoteExit:{"n":2}')
  })

  it('passes an unknown code through rather than hiding it', () => {
    expect(publishErrorText('something-new', t)).toBe('something-new')
  })

  it('says nothing when there was no error', () => {
    expect(publishErrorText(undefined, t)).toBe('')
  })
})
