import { it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Writable, Readable } from 'node:stream'
vi.mock('electron', () => ({ app: { getPath: () => 'tmp-local' } }))
const { SshManager } = await import('./ssh')
it.each(['edit', 'upload', 'sync'])('F3 %s stages failures without truncating the target', async kind => {
  const dir = await mkdtemp(resolve('tmp-local/staging-'))
  const local = join(dir, 'key'); await writeFile(local, 'new')
  const files = new Map([['/r/key', 'original']])
  const sftp = {
    realpath: (p: string, cb: Function) => cb(null, p),
    stat: (_: string, cb: Function) => cb(null, { mode: 0o100600, size: 8, mtime: 0 }),
    mkdir: (_: string, cb: Function) => cb(null),
    createWriteStream: (p: string) => { files.set(p, ''); return new Writable({ construct(cb) { this.emit('open'); cb() }, write(_c, _e, cb) { cb(new Error('drop')) } }) },
    unlink: (p: string, cb: Function) => { files.delete(p); cb(null) },
    ext_openssh_rename: (a: string, b: string, cb: Function) => { files.set(b, files.get(a)!); files.delete(a); cb(null) }
  }
  const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, {} as never) as any
  mgr.getSftp = async () => sftp
  try {
    if (kind === 'edit') await mgr.putFileSilent('s', local, '/r', 'key').catch(() => {})
    if (kind === 'upload') await mgr.uploadJob('s', [local], '/r', 'j', 1)
    if (kind === 'sync') {
      mgr.walkRemoteTree = async (_s: unknown, _d: string, _b: string, map: Map<string, unknown>) => { map.set('key', { size: 8, mtimeMs: 0 }); return true }
      await mgr.syncJob('s', dir, '/r', 'up', false, 'j', 1)
    }
    expect([...files]).toEqual([['/r/key', 'original']])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
it('F3 download failure preserves an existing local destination', async () => {
  const dir = await mkdtemp(resolve('tmp-local/download-')); await writeFile(join(dir, 'a'), 'original')
  const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, {} as never) as any
  mgr.getSftp = async () => ({ createReadStream: () => new Readable({ read() { this.push('half'); this.destroy(new Error('drop')) } }) })
  mgr.statSize = async () => 10; mgr.statFile = async () => ({ size: 10, mtimeMs: 1000 })
  try {
    await mgr.downloadJob('s', [{ path: '/a', name: 'a', isDir: false }], dir, 'j', 1)
    expect(await readFile(join(dir, 'a'), 'utf8')).toBe('original')
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
})
it('F3 successful staged upload closes before atomically replacing and preserves mode', async () => {
  const dir = await mkdtemp(resolve('tmp-local/success-')); const local = join(dir, 'key'); await writeFile(local, 'new')
  const files = new Map([['/r/key', 'original']]); let closed = false
  const sftp = {
    realpath: (p: string, cb: Function) => cb(null, p),
    stat: (_: string, cb: Function) => cb(null, { mode: 0o100600 }),
    createWriteStream: (p: string, opts: any) => {
      expect(opts).toMatchObject({ flags: 'wx', mode: 0o600 }); expect(p).toContain('.xssh-part-')
      const w = new Writable({ write(c, _e, cb) { files.set(p, (files.get(p) || '') + c); cb() } })
      w.on('close', () => { closed = true }); return w
    },
    unlink: (p: string, cb: Function) => { files.delete(p); cb(null) },
    ext_openssh_rename: (a: string, b: string, cb: Function) => { expect(closed).toBe(true); expect(files.get(b)).toBe('original'); files.set(b, files.get(a)!); files.delete(a); cb(null) }
  }
  const mgr = new SshManager({} as never, {} as never) as any; mgr.getSftp = async () => sftp
  try { await mgr.putFileSilent('s', local, '/r', 'key'); expect([...files]).toEqual([['/r/key', 'new']]) }
  finally { await rm(dir, { recursive: true, force: true }) }
})
it('F3 an exclusive-create refusal never unlinks a temporary file it did not open', async () => {
  const dir = await mkdtemp(resolve('tmp-local/collision-')); const local = join(dir, 'key'); await writeFile(local, 'new')
  const unlink = vi.fn((_p: string, cb: Function) => cb(null))
  const sftp = {
    realpath: (p: string, cb: Function) => cb(null, p),
    stat: (_p: string, cb: Function) => cb(null, { mode: 0o100600 }),
    createWriteStream: () => new Writable({ construct(cb) { cb(Object.assign(new Error('exists'), { code: 4 })) }, write(_c, _e, cb) { cb() } }),
    unlink
  }
  const mgr = new SshManager({} as never, {} as never) as any; mgr.getSftp = async () => sftp
  try { await expect(mgr.putFileSilent('s', local, '/r', 'key')).rejects.toThrow('exists'); expect(unlink).not.toHaveBeenCalled() }
  finally { await rm(dir, { recursive: true, force: true }) }
})
it('F3 resolves an existing remote symlink before staging its replacement', async () => {
  const dir = await mkdtemp(resolve('tmp-local/remote-link-')); const local = join(dir, 'key'); await writeFile(local, 'new')
  const rename = vi.fn((_a: string, _b: string, cb: Function) => cb(null))
  const sftp = {
    realpath: (_p: string, cb: Function) => cb(null, '/actual/key'),
    stat: (_p: string, cb: Function) => cb(null, { mode: 0o100600 }),
    createWriteStream: () => new Writable({ write(_c, _e, cb) { cb() } }),
    ext_openssh_rename: rename,
    unlink: (_p: string, cb: Function) => cb(null)
  }
  const mgr = new SshManager({} as never, {} as never) as any; mgr.getSftp = async () => sftp
  try { await mgr.putFileSilent('s', local, '/r', 'key'); expect(rename).toHaveBeenCalledWith(expect.stringContaining('/actual/key.xssh-part-'), '/actual/key', expect.any(Function)) }
  finally { await rm(dir, { recursive: true, force: true }) }
})
it('F3 bounds cleanup when ssh2 never emits close or answers unlink', async () => {
  vi.useFakeTimers()
  try {
    const mgr = new SshManager({} as never, {} as never) as any
    mgr.stagingCleanupTimeoutMs = 10
    const stream = Object.assign(new (await import('node:events')).EventEmitter(), { destroy: vi.fn(), closed: false })
    const close = mgr.closeStagingStream(stream)
    await vi.advanceTimersByTimeAsync(11); await close
    expect(stream.destroy).toHaveBeenCalled()
    const unlink = mgr.cleanupRemoteStage({ unlink: vi.fn() }, '/owned-part')
    await vi.advanceTimersByTimeAsync(11); await unlink
  } finally { vi.useRealTimers() }
})
