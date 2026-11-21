import { it, expect, vi } from 'vitest'
import { mkdirSync } from 'node:fs'

mkdirSync('tmp-local', { recursive: true })
vi.mock('electron', () => ({ app: { getPath: () => 'tmp-local' } }))
const { SshManager } = await import('./ssh')

function manager(send: ReturnType<typeof vi.fn>): any {
  return new SshManager({ isDestroyed: () => false, send } as never, {} as never) as any
}

it('the first attach flushes what arrived before anyone listened, and replays nothing twice', () => {
  const send = vi.fn()
  const m = manager(send)
  m.sessions.set('s', { id: 's', attached: false, pendingBuf: 'MOTD\r\n$ ', history: { chunks: ['MOTD\r\n$ '], size: 8, head: 0 } })
  m.attach('s')
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][1]).toEqual({ sessionId: 's', data: 'MOTD\r\n$ ' })
  // ...and it is not recorded a second time, or a later replay would show it twice.
  expect(m.sessions.get('s').history.chunks).toEqual(['MOTD\r\n$ '])
})

it('a terminal mounted again for a live session gets the retained output back', () => {
  const send = vi.fn()
  const m = manager(send)
  m.sessions.set('s', { id: 's', attached: true, history: { chunks: ['', 'one\r\n', 'two\r\n'], size: 10, head: 1 } })
  m.attach('s')
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][1]).toEqual({ sessionId: 's', data: 'one\r\ntwo\r\n' })
})

it('nothing to replay, or no such session, sends nothing', () => {
  const send = vi.fn()
  const m = manager(send)
  m.sessions.set('s', { id: 's', attached: true })
  m.attach('s')
  m.attach('missing')
  expect(send).not.toHaveBeenCalled()
})
