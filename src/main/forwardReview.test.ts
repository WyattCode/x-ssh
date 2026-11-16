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
