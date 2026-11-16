import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { SshManager } = await import('./ssh')
it('B5 rejects duplicate remote forwards without replacing the live handler', async () => {
  const mgr = new SshManager({} as never, {} as never) as any
  const client = Object.assign(new EventEmitter(), { forwardIn: vi.fn((_: string, __: number, cb: Function) => cb(new Error('busy'))) })
  const old = vi.fn()
  const session = { client, remoteForwards: new Map([[9000, old]]) }
  mgr.sessions.set('s', session)
  mgr.remoteForwardTable(client).set(9000, old)
  expect(await mgr.addForward('s', { mode: 'remote', localPort: 9000, remotePort: 22 })).toMatchObject({ ok: false, code: 'already' })
  expect(session.remoteForwards.get(9000)).toBe(old)
  expect(mgr.remoteForwardTable(client).get(9000)).toBe(old)
  expect(client.forwardIn).not.toHaveBeenCalled()
})
it('B3 closes listeners that finish binding after their session was removed', async () => {
  const mgr = new SshManager({} as never, {} as never) as any
  const session = { id: 's' }
  const server = { close: vi.fn() }
  mgr.sessions.set('s', session)
  mgr.openRule = () => [server]
  mgr.waitForListen = async () => { mgr.sessions.delete('s'); return true }
  await mgr.openForwards(session, [{ localPort: 9000 }])
  expect(server.close).toHaveBeenCalled()
  expect((session as any).forwardServers?.length ?? 0).toBe(0)
})
it('B3 bounds remote forward negotiation and discards late success', async () => {
  vi.useFakeTimers()
  try {
    const mgr = new SshManager({} as never, {} as never) as any
    mgr.forwardOutTimeoutMs = 10
    let callback: Function = () => {}
    const client = Object.assign(new EventEmitter(), { forwardIn: (_: string, __: number, cb: Function) => { callback = cb }, unforwardIn: vi.fn() })
    const session = { id: 's', client }
    mgr.sessions.set('s', session)
    const pending = mgr.openRemoteForward(session, { localPort: 9000 })
    await vi.advanceTimersByTimeAsync(11)
    expect(await pending).toBe(false)
    callback(null)
    expect(mgr.remoteForwardTable(client).size).toBe(0)
    expect(client.unforwardIn).toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
it('B4 converts synchronous ssh2 forwarding throws into callback errors', () => {
  const mgr = new SshManager({} as never, {} as never) as any
  const callback = vi.fn()
  const client = { forwardOut: () => { throw new Error('Not connected') } }
  expect(() => mgr.safeForwardOut(client, '127.0.0.1', 0, 'host', 22, callback)).not.toThrow()
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: 'Not connected' }), undefined)
})
