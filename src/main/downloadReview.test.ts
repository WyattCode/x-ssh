import { it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { SshManager } = await import('./ssh')
it('B8 records the remote version when a first download is interrupted', async () => {
  const dir = await mkdtemp(resolve('tmp-local/xssh-part-'))
  try {
    const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, {} as never) as any
    mgr.getSftp = async () => ({ createReadStream: () => new PassThrough() })
    mgr.statSize = async () => 10
    mgr.statFile = async () => ({ size: 10, mtimeMs: 1000 })
    mgr.pipeStream = async (_j: string, _r: unknown, w: any) => { await new Promise<void>(r => w.end('half', r)); throw new Error('drop') }
    await mgr.downloadJob('s', [{ path: '/a', name: 'a', isDir: false }], dir, 'j', 1)
    expect(mgr.partialDownloads.get('s\0/a')).toMatchObject({ localSize: 4, remoteSize: 10, remoteMtimeMs: 1000, path: expect.stringContaining('.xssh-part-') })
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
})
it('B7 applies backpressure before traversing the rest of a large listing', async () => {
  const dir = await mkdtemp(resolve('tmp-local/xssh-queue-'))
  const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, {} as never) as any
  const ctor = SshManager as any
  const old = ctor.QUEUE_MAX
  ctor.QUEUE_MAX = 2
  let visited = 0
  let release: () => void = () => {}
  const barrier = new Promise<void>(r => { release = r })
  mgr.getSftp = async () => ({ createReadStream: () => new PassThrough() })
  mgr.statFile = async () => null
  mgr.readdirFull = async () => Array.from({ length: 20 }, (_, i) => ({ filename: `${i}`, attrs: { size: 1, isDirectory: () => false } }))
  const real = mgr.safeLocalJoin.bind(mgr)
  mgr.safeLocalJoin = (...args: string[]) => { visited++; return real(...args) }
  mgr.pipeStream = async (_j: string, _r: unknown, w: any) => { await barrier; w.end() }
  try {
    const job = mgr.downloadJob('s', [{ path: '/d', name: 'd', isDir: true }], dir, 'j', 1)
    await new Promise(r => setTimeout(r, 60))
    const observed = visited
    mgr.cancelledJobs.add('j'); release(); await job
    expect(observed).toBeLessThan(10)
  } finally { release(); ctor.QUEUE_MAX = old; await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
})
