import { describe, expect, it } from 'vitest'
import { ipcReason } from './ipcError'

describe('ipcReason', () => {
  it('drops the invoke wrapper and the error class', () => {
    expect(ipcReason(new Error("Error invoking remote method 'hosts:save': Error: EPERM: operation not permitted, open 'x'"))).toBe(
      "EPERM: operation not permitted, open 'x'"
    )
    expect(ipcReason(new Error("Error invoking remote method 'fw:add': TypeError: bad port"))).toBe('bad port')
  })
  it('keeps a reason that has no error class', () => {
    expect(ipcReason(new Error("Error invoking remote method 'sftp:sync': secrets-unavailable"))).toBe('secrets-unavailable')
  })
  it('leaves ordinary messages alone', () => {
    expect(ipcReason(new Error('EACCES: permission denied'))).toBe('EACCES: permission denied')
    expect(ipcReason('plain')).toBe('plain')
  })
  it('is empty for nothing', () => {
    expect(ipcReason(undefined)).toBe('')
    expect(ipcReason(null)).toBe('')
    expect(ipcReason({})).toBe('')
  })
})
