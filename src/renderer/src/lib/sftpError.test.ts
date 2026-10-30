import { describe, it, expect } from 'vitest'
import { sftpErrorText } from './sftpError'

/** Stands in for i18n: echoes the key and inlines any vars. */
const t = (key: string, vars?: Record<string, string | number>): string =>
  vars ? `${key}:${JSON.stringify(vars)}` : key

describe('sftpErrorText', () => {
  it('maps every fixed code to its own key', () => {
    expect(sftpErrorText('session-missing', 'fb', t)).toBe('sfp.sessionMissing')
    expect(sftpErrorText('session-gone', 'fb', t)).toBe('sfp.sessionGone')
    expect(sftpErrorText('remote-timeout', 'fb', t)).toBe('sfp.remoteTimeout')
    expect(sftpErrorText('unsafe-filename', 'fb', t)).toBe('sfp.unsafeFilename')
    expect(sftpErrorText('extract-failed', 'fb', t)).toBe('sfp.extractFail')
    expect(sftpErrorText('sync-list-failed', 'fb', t)).toBe('sfp.syncListFailed')
    expect(sftpErrorText('window-not-ready', 'fb', t)).toBe('app.windowNotReady')
  })

  it('turns a partial delete into a count', () => {
    expect(sftpErrorText('delete-failed:3', 'fb', t)).toBe('sfp.deletePartial:{"n":3}')
  })

  it('delegates the files-failed marker to the shared formatter', () => {
    // transferFormat owns this one so the transfer panel and the drawer agree.
    expect(sftpErrorText('files-failed:2', 'fb', t)).toBe('sfp.filesFailed:{"n":2}')
  })

  it('passes a genuine message through untouched', () => {
    // Main already ran these through friendlyError; re-wrapping would only
    // duplicate the wording.
    expect(sftpErrorText('Permission denied', 'fb', t)).toBe('Permission denied')
    expect(sftpErrorText('磁盘已满', 'fb', t)).toBe('磁盘已满')
  })

  it('uses the caller fallback only when there is no message', () => {
    expect(sftpErrorText(undefined, 'sfp.delFail', t)).toBe('sfp.delFail')
    expect(sftpErrorText('', 'sfp.uploadFail', t)).toBe('sfp.uploadFail')
  })

  it('does not mistake a code-like message for a known code', () => {
    // A bare substring must not match: the lookup is exact.
    expect(sftpErrorText('session-missing (retry)', 'fb', t)).toBe('session-missing (retry)')
    expect(sftpErrorText('delete-failed:', 'fb', t)).toBe('delete-failed:')
  })
})