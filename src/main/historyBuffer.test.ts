import { it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { SshManager } = await import('./ssh')
it('B9 retains history as bounded chunks and joins only for a reader', () => {
  const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, {} as never) as any
  const session: any = { attached: true }
  mgr.sessions.set('s', session)
  for (let i = 0; i < 100; i++) mgr.sendData('s', String(i).padStart(4, '0').repeat(1000))
  expect(typeof session.history).not.toBe('string')
  const all = Array.from({ length: 100 }, (_, i) => String(i).padStart(4, '0').repeat(1000)).join('')
  expect(mgr.historyList()[0].text).toBe(all.slice(-256 * 1024))
})
