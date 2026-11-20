import { it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Writable } from 'node:stream'

mkdirSync('tmp-local', { recursive: true })
vi.mock('electron', () => ({ app: { getPath: () => 'tmp-local' } }))
const { SshManager } = await import('./ssh')

const noFile = (): Error => Object.assign(new Error('No such file'), { code: 2 })

/** A Writable that behaves like ssh2's SFTP WriteStream: _final() destroys the
 *  stream before calling back, so a clean end emits 'close' but never 'finish'
 *  and writableFinished stays false. Every upload to a real server went through
 *  this and was reported as "transfer-closed-before-finish". */
function ssh2LikeWrite(files: Map<string, string>, path: string): Writable {
  files.set(path, '')
  return new Writable({
    construct(cb) { this.emit('open'); cb() },
    write(chunk, _e, cb) { files.set(path, files.get(path)! + chunk); cb() },
    final(cb) { this.destroy(); cb() }
  })
}

async function withLocal(body: (local: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(resolve('tmp-local/complete-'))
  const local = join(dir, '1.png')
  await writeFile(local, 'payload')
  try { await body(local) } finally { await rm(dir, { recursive: true, force: true }) }
}

function manager(sftp: unknown): any {
  const mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, {} as never) as any
  mgr.getSftp = async () => sftp
  return mgr
}

/** In-memory SFTP: plain v3 rename refuses to replace an existing file. */
function memorySftp(files: Map<string, string>, ext: unknown, renameHook?: (n: number) => boolean): Record<string, unknown> {
  let renames = 0
  return {
    realpath: (p: string, cb: Function) => cb(null, p),
    stat: (p: string, cb: Function) => files.has(p) ? cb(null, { mode: 0o100600 }) : cb(noFile()),
    createWriteStream: (p: string) => ssh2LikeWrite(files, p),
    unlink: (p: string, cb: Function) => { files.delete(p); cb(null) },
    ext_openssh_rename: ext,
    rename: (a: string, b: string, cb: Function) => {
      renames++
      if (files.has(b) || renameHook?.(renames)) return cb(Object.assign(new Error('Failure'), { code: 4 }))
      files.set(b, files.get(a)!); files.delete(a); cb(null)
    }
  }
}

const noPosixRename = (): never => { throw new Error('Server does not support this extended request') }

it('an ssh2-style stream that closes without finish still counts as a finished upload', async () => {
  await withLocal(async local => {
    const files = new Map<string, string>()
    const sftp = memorySftp(files, (a: string, b: string, cb: Function) => { files.set(b, files.get(a)!); files.delete(a); cb(null) })
    sftp.realpath = (_p: string, cb: Function) => cb(noFile())
    const r = await manager(sftp).uploadJob('s', [local], '/r', 'j1', 1)
    expect(r).toMatchObject({ files: 1, failures: 0 })
    expect([...files]).toEqual([['/r/1.png', 'payload']])
  })
})

it('a stream torn down before end() is still a failure and leaves no staged file', async () => {
  await withLocal(async local => {
    const files = new Map<string, string>()
    const sftp = memorySftp(files, (_a: string, _b: string, cb: Function) => cb(null))
    sftp.createWriteStream = (p: string) => {
      files.set(p, '')
      return new Writable({ construct(cb) { this.emit('open'); cb() }, write(_c, _e, cb) { this.destroy(); cb() } })
    }
    const r = await manager(sftp).uploadJob('s', [local], '/r', 'j2', 1)
    expect(r).toMatchObject({ files: 0, failures: 1 })
    expect([...files]).toEqual([])
  })
})

it.each([
  ['throws because the extension was never advertised', noPosixRename],
  ['answers OP_UNSUPPORTED', (_a: string, _b: string, cb: Function) => cb(Object.assign(new Error('unsupported'), { code: 8 }))]
])('a server without posix-rename %s: a new file uploads with plain rename', async (_name, ext) => {
  await withLocal(async local => {
    const files = new Map<string, string>()
    const r = await manager(memorySftp(files, ext)).uploadJob('s', [local], '/r', 'j3', 1)
    expect(r).toMatchObject({ files: 1, failures: 0 })
    expect([...files]).toEqual([['/r/1.png', 'payload']])
  })
})

it('without posix-rename an existing file is replaced via a moved-aside copy that is removed afterwards', async () => {
  await withLocal(async local => {
    const files = new Map<string, string>([['/r/1.png', 'old']])
    const mgr = manager(memorySftp(files, noPosixRename))
    mgr.statFile = async () => ({ size: 3, mtimeMs: 0 }) // older than the local file, so it is sent again
    const r = await mgr.uploadJob('s', [local], '/r', 'j4', 1)
    expect(r).toMatchObject({ files: 1, failures: 0 })
    expect([...files]).toEqual([['/r/1.png', 'payload']])
  })
})

it('if the final rename fails the original file is put back', async () => {
  await withLocal(async local => {
    const files = new Map<string, string>([['/r/1.png', 'old']])
    // rename calls: 1 temp->target (refused, exists) 2 target->old 3 temp->target (fails) 4 old->target (restore)
    const mgr = manager(memorySftp(files, noPosixRename, n => n === 3))
    mgr.statFile = async () => ({ size: 3, mtimeMs: 0 })
    const r = await mgr.uploadJob('s', [local], '/r', 'j5', 1)
    expect(r).toMatchObject({ files: 0, failures: 1 })
    expect(files.get('/r/1.png')).toBe('old')
    expect([...files.keys()].filter(k => k !== '/r/1.png')).toEqual([])
  })
})

it('sync download creates the local destination folder with the local path rules (Windows C:\ was mkdir-ed instead)', async () => {
  const { readFile: read, mkdir: mk } = await import('node:fs/promises')
  const { Readable } = await import('node:stream')
  const dir = await mkdtemp(resolve('tmp-local/syncdown-'))
  try {
    await mk(join(dir, 'dest'))
    const sftp = {
      createReadStream: () => Readable.from([Buffer.from('remote data')]),
      stat: (_: string, cb: Function) => cb(null, { size: 11, mtime: 0 }),
      realpath: (p: string, cb: Function) => cb(null, p)
    }
    const mgr = manager(sftp)
    mgr.walkRemoteTree = async (_s: unknown, _d: string, _b: string, map: Map<string, unknown>) => {
      map.set('s1.txt', { size: 11, mtimeMs: 1000 })
      return true
    }
    const r = await mgr.syncJob('s', join(dir, 'dest'), '/r', 'down', false, 'sj', 1)
    expect(r).toMatchObject({ cancelled: false, errors: 0 })
    expect(await read(join(dir, 'dest', 's1.txt'), 'utf8')).toBe('remote data')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
