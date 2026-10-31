import { describe, expect, it } from 'vitest'
import { connectActions } from './connectActions'

describe('connectActions', () => {
  it('offers the private-key picker for a missing key', () => {
    expect(connectActions('needs_key', { hostId: 'h1' })).toEqual([
      { kind: 'edit-host', labelKey: 'app.actEditHost' }
    ])
    expect(connectActions('no-private-key', { hostId: 'h1' })[0].kind).toBe('edit-host')
  })

  it('offers the credential editor for every missing-or-wrong secret', () => {
    for (const code of ['needs_password', 'needs_passphrase', 'bad_passphrase', 'auth_failed']) {
      expect(connectActions(code, { hostId: 'h1' }), code).toEqual([
        { kind: 'set-creds', labelKey: 'app.actSetCreds' }
      ])
    }
  })

  it('sends a broken hop to that hop profile, falling back to the target', () => {
    for (const code of ['jump_missing', 'jump_needs_password', 'jump_needs_key']) {
      expect(connectActions(code, { hostId: 'h1', jumpHostId: 'j1' }), code).toEqual([
        { kind: 'fix-jump', labelKey: 'app.actFixJump' }
      ])
      expect(connectActions(code, { hostId: 'h1' })[0].kind, code).toBe('fix-jump')
    }
  })

  it('sends a corrupt secret store to the security settings, saved host or not', () => {
    const want = [{ kind: 'security-settings', labelKey: 'app.actOpenSecurity' }]
    expect(connectActions('secrets_load_failed', {})).toEqual(want)
    expect(connectActions('secrets_load_failed', { hostId: 'h1' })).toEqual(want)
  })

  it('offers nothing when there is no saved host to open', () => {
    // A quick-connect pane has no profile to edit — sending the user to an empty
    // editor would be worse than leaving them the reconnect button.
    expect(connectActions('needs_key', {})).toEqual([])
    expect(connectActions('needs_password', {})).toEqual([])
    expect(connectActions('jump_missing', {})).toEqual([])
  })

  it('offers nothing for a host-key rejection or an unknown code', () => {
    // The trust card has its own primary action; a second button would compete with it.
    expect(connectActions('host_key_unknown', { hostId: 'h1' })).toEqual([])
    expect(connectActions('host_key_changed', { hostId: 'h1' })).toEqual([])
    expect(connectActions('socks5-auth-failed', { hostId: 'h1' })).toEqual([])
    expect(connectActions(undefined, { hostId: 'h1' })).toEqual([])
  })
})
