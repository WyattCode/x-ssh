import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { SshManager } = await import('./ssh')
it('B1 invalidates an errored SFTP channel without an unhandled error', async () => {
  const channel = new EventEmitter()
  const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, {} as never)
  const session = { client: { sftp: (cb: Function) => cb(null, channel) } }
  const internal = mgr as any
  internal.sessions.set('s', session)
  await internal.getSftp('s')
  expect(() => channel.emit('error', new Error('bad packet'))).not.toThrow()
  expect((session as any).sftp).toBeUndefined()
})
it.each([0o100600, 0o100755])('B2 preserves existing remote mode %o', async (mode) => {
  const mgr = new SshManager({} as never, {} as never) as any
  const sftp = { stat: (_: string, cb: Function) => cb(null, { mode }) }
  expect(await mgr.remoteWriteOptions(sftp, '/key', 12)).toEqual({ flags: 'r+', start: 12, mode: mode & 0o7777 })
})
it('B2 refuses to guess permissions when stat fails', async () => {
  const mgr = new SshManager({} as never, {} as never) as any
  const sftp = { stat: (_: string, cb: Function) => cb(Object.assign(new Error('denied'), { code: 3 })) }
  await expect(mgr.remoteWriteOptions(sftp, '/key')).rejects.toThrow('denied')
})
it('B6 times out an unanswered handshake and closes a late channel', async () => {
  vi.useFakeTimers()
  try {
    const mgr = new SshManager({} as never, {} as never) as any
    mgr.sftpTimeoutMs = 10
    let cb: Function = () => {}
    const session = { client: { sftp: (callback: Function) => { cb = callback } } }
    mgr.sessions.set('s', session)
    const pending = expect(mgr.getSftp('s')).rejects.toThrow('sftp-timeout')
    await vi.advanceTimersByTimeAsync(11); await pending
    expect((session as any).sftpPromise).toBeUndefined()
    const channel = Object.assign(new EventEmitter(), { end: vi.fn() })
    cb(null, channel)
    expect(channel.end).toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
