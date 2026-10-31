/**
 * Publish / revoke report their failures from the main process as stable
 * machine codes (`app-locked`, `jump-needs-key`, `remote-exit:2`). Everything
 * the dialog shows goes through here, so nothing main wrote can reach an
 * English UI untranslated; an unknown code still shows itself rather than
 * disappearing.
 */
const CODE_KEYS: Record<string, string> = {
  'host-missing': 'keyPub.hostMissing',
  'app-locked': 'keyPub.appLocked',
  'connect-failed': 'keyPub.connectFailed',
  'window-not-ready': 'app.windowNotReady',
  'jump-missing': 'app.jumpMissing',
  'jump-needs-password': 'app.jumpNeedsPassword',
  'jump-needs-key': 'app.jumpNeedsKey',
  'no-public-key': 'keyPub.noPublicKey',
  userVerifyCanceled: 'hello.canceled',
  userVerifyFailed: 'hello.failed',
  'no-pubkey': 'host.keyNoPub',
  'not-ready': 'host.keyNotReady'
}

export function publishErrorText(
  msg: string | undefined,
  t: (k: string, vars?: Record<string, string | number>) => string
): string {
  if (!msg) return ''
  const exit = /^remote-exit:(\d+)$/.exec(msg)
  if (exit) return t('keyPub.remoteExit', { n: Number(exit[1]) })
  const key = CODE_KEYS[msg]
  return key ? t(key) : msg
}
