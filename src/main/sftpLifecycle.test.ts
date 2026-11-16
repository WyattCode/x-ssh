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
