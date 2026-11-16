import { EventEmitter } from 'node:events'
import { it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { SshManager } = await import('./ssh')
it('B15 times out and closes a hung command channel', async () => {
  vi.useFakeTimers()
  try {
    const mgr = new SshManager({} as never, {} as never) as any
    mgr.execTimeoutMs = 10
    const stream = Object.assign(new EventEmitter(), { close: vi.fn() })
    mgr.sessions.set('s', { client: { exec: (_: string, cb: Function) => cb(null, stream) } })
    const pending = expect(mgr.remoteExec('s', 'hang')).rejects.toThrow('remote-timeout')
    await vi.advanceTimersByTimeAsync(11)
    await pending
    expect(stream.close).toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
it('B15 bounds stdout from a continuously producing command', async () => {
  const mgr = new SshManager({} as never, {} as never) as any
  const stream = Object.assign(new EventEmitter(), { close: vi.fn() })
  mgr.sessions.set('s', { client: { exec: (_: string, cb: Function) => cb(null, stream) } })
  const pending = mgr.remoteExec('s', 'large')
  stream.emit('data', Buffer.alloc(100000, 'a'))
  stream.emit('close')
  expect(Buffer.byteLength(await pending)).toBeLessThanOrEqual(65536)
})
