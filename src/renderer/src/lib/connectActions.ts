/**
 * A failed connect used to end with a sentence telling the user what to do —
 * "请在「主机」编辑页导入或选择私钥后重试" — and no way to do it. The wording
 * already names the action, so the card next to it should carry the button.
 *
 * One action per failure: the reason is single-valued, and two buttons would
 * just put the user back to deciding.
 */
export type ConnectActionKind = 'edit-host' | 'set-creds' | 'fix-jump' | 'security-settings'

export interface ConnectAction {
  kind: ConnectActionKind
  labelKey: string
}

const CREDENTIAL_CODES = ['needs_password', 'needs_passphrase', 'bad_passphrase', 'auth_failed']
const KEY_CODES = ['needs_key', 'no-private-key']
const JUMP_CODES = ['jump_missing', 'jump_needs_password', 'jump_needs_key']

export function connectActions(
  code: string | undefined,
  ctx: { hostId?: string; jumpHostId?: string }
): ConnectAction[] {
  if (!code) return []

  // A deleted or unconfigured hop: the jump host's own profile is the thing to fix.
  if (JUMP_CODES.includes(code)) {
    const id = ctx.jumpHostId ?? ctx.hostId
    return id ? [{ kind: 'fix-jump', labelKey: 'app.actFixJump' }] : []
  }

  // Quick-connect panes have no saved host to open, so they get no button.
  if (KEY_CODES.includes(code)) {
    return ctx.hostId ? [{ kind: 'edit-host', labelKey: 'app.actEditHost' }] : []
  }
  if (CREDENTIAL_CODES.includes(code)) {
    return ctx.hostId ? [{ kind: 'set-creds', labelKey: 'app.actSetCreds' }] : []
  }

  // Corrupt secrets.bin is an app-level problem, not this host's.
  if (code === 'secrets_load_failed') {
    return [{ kind: 'security-settings', labelKey: 'app.actOpenSecurity' }]
  }

  // host_key_* already has its own trust button; anything else has nothing safe to offer.
  return []
}
