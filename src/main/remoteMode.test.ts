import { it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { Writable } from 'node:stream'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
const { SshManager } = await import('./ssh')
it.each(['edit', 'upload', 'sync'])('B2 preserves private permissions through the %s entry point', async (kind) => {
  const dir = await mkdtemp(resolve('tmp-local/xssh-mode-'))
  try {
    const local = join(dir, 'key')
    await writeFile(local, 'new key material')
    const modes: number[] = []
    const sftp = {
      realpath: (p: string, cb: Function) => cb(null, p),
      stat: (_: string, cb: Function) => cb(null, { mode: 0o100600, size: 0, mtime: 0 }),
      ext_openssh_rename: (_a: string, _b: string, cb: Function) => cb(null),
      unlink: (_p: string, cb: Function) => cb(null),
      mkdir: (_: string, cb: Function) => cb(null),
      createWriteStream: (_: string, opts?: { mode?: number }) => {
        modes.push(opts?.mode ?? 0o666)
        return new Writable({ write(_chunk, _encoding, cb) { cb() } })
      }
    }
    const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, {} as never) as any
    mgr.getSftp = async () => sftp
    if (kind === 'edit') await mgr.putFileSilent('s', local, '/remote', 'key')
    if (kind === 'upload') await mgr.uploadJob('s', [local], '/remote', 'j', 1)
    if (kind === 'sync') {
      mgr.walkRemoteTree = async (_s: unknown, _d: string, _b: string, map: Map<string, unknown>) => { map.set('key', { size: 0, mtimeMs: 0 }); return true }
      await mgr.syncJob('s', dir, '/remote', 'up', false, 'j', 1)
    }
    expect(modes).toEqual([0o600])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
