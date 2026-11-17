import { EventEmitter } from 'node:events'
import { it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => 'tmp-local' } }))
vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')
  return { Client: class extends EventEmitter {
    connect(): void { queueMicrotask(() => this.emit('ready')) }
    shell(...args: any[]): void {
      args.at(-1)(null, Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: vi.fn(), write: vi.fn() }))
    }
    end(): void { this.emit('close') }
  } }
})
const { SshManager } = await import('./ssh')
it.each(['fresh', 'reuse'])('F1 %s keeps a ready shell alive beyond the handshake budget while forwards negotiate', async kind => {
  vi.useFakeTimers()
  try {
    const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, { load: async () => undefined } as never) as any
    const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: vi.fn(), write: vi.fn() })
    const client = { shell: (...args: any[]) => args.at(-1)(null, stream) }
    mgr.sessions.set('s', { id: 's', client })
    const disconnect = vi.spyOn(mgr, 'disconnect').mockImplementation(() => undefined)
    let finish!: (v: number[]) => void
    mgr.openForwards = () => new Promise(resolve => { finish = resolve })
    const params = { host: 'h', username: 'u', auth: 'password', password: 'p', readyTimeoutMs: 20, portForwards: [{ localPort: 9000 }] }
    const pending = kind === 'fresh' ? mgr.connect(params) : mgr.openReuseShell('s', client, params)
    await vi.advanceTimersByTimeAsync(21)
    expect(disconnect).not.toHaveBeenCalled()
    finish([9000])
    expect(await pending).toMatchObject({ ok: true, code: 'forward:in-use' })
  } finally { vi.useRealTimers() }
})
