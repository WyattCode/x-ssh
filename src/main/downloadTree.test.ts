import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

let dir = ''
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { SshManager } = await import('./ssh')
const { KnownHosts } = await import('./knownHosts')

interface FakeEntry {
  name: string
  dir: boolean
}

/** A remote tree: `dirs` maps a directory path to its children, `files` maps a
 *  file path to its body. A file missing from `files`, or with `fail`, cannot be
 *  read — the stand-in for a permission error or a vanished entry. */
interface FakeTree {
  dirs: Record<string, FakeEntry[]>
  files: Record<string, { body?: string; fail?: boolean }>
}

const STREAM_DELAY = 20

/** A stand-in SFTPWrapper covering exactly what downloadTree touches. `stats`
 *  counts how many file streams were open at once — the pool's whole purpose,
 *  and what a serial implementation can never reach above 1. */
function fakeSftp(tree: FakeTree, stats: { maxInFlight: number }) {
  let inFlight = 0
  return {
    readdir(path: string, cb: (err: Error | null, list?: unknown) => void): void {
      const list = tree.dirs[path]
      if (!list) {
        cb(new Error(`ENOENT: no such directory, ${path}`))
        return
      }
      cb(
        null,
        list.map((e) => ({
          filename: e.name,
          attrs: { size: 4, isDirectory: () => e.dir }
        }))
      )
    },
    createReadStream(path: string): Readable {
      inFlight++
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight)
      const r = new Readable({ read(): void {} })
      const f = tree.files[path]
      setTimeout(() => {
        inFlight--
        if (!f || f.fail) {
          r.destroy(new Error(`EACCES: permission denied, ${path}`))
        } else {
          r.push(Buffer.from(f.body ?? ''))
          r.push(null)
        }
      }, STREAM_DELAY)
      return r
    }
  }
}

/** Installs a fake SFTP channel for the duration of one call. */
async function withTree<T>(
  mgr: InstanceType<typeof SshManager>,
  tree: FakeTree,
  run: (stats: { maxInFlight: number }) => Promise<T>
): Promise<T> {
  const stats = { maxInFlight: 0 }
  const target = mgr as unknown as { getSftp: (id: string) => Promise<unknown> }
  const real = target.getSftp
  target.getSftp = async () => fakeSftp(tree, stats)
  try {
    return await run(stats)
  } finally {
    target.getSftp = real
  }
}

describe('downloadTree', () => {
  let mgr: InstanceType<typeof SshManager>
  let base = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'xssh-dt-'))
    base = dir
    const kh = new KnownHosts()
    await kh.load()
    mgr = new SshManager({ isDestroyed: () => false, send: vi.fn() } as never, kh)
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const out = (...parts: string[]): string => join(base, ...parts)

  /** A failed stream deletes its half-written local file only AFTER the write fd
   *  closes (pipeStream does that to dodge Windows EPERM), so the cleanup lands
   *  a beat after downloadTree settles — waiting, not asserting instantly, is
   *  what makes this independent of how many workers happened to be running. */
  const goneWithin = async (p: string): Promise<boolean> => {
    for (let i = 0; i < 40; i++) {
      if (!existsSync(p)) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return false
  }

  it('downloads a nested tree, contents intact', async () => {
    const tree: FakeTree = {
      dirs: {
        '/r': [{ name: 'a.txt', dir: false }, { name: 'sub', dir: true }],
        '/r/sub': [{ name: 'b.txt', dir: false }, { name: 'deep', dir: true }],
        '/r/sub/deep': [{ name: 'c.txt', dir: false }]
      },
      files: { '/r/a.txt': { body: 'AAA' }, '/r/sub/b.txt': { body: 'BBB' }, '/r/sub/deep/c.txt': { body: 'CCC' } }
    }
    await withTree(mgr, tree, async (stats) => {
      const top = await mgr.downloadTree('s', '/r', base, 'r', true)
      expect(top).toBe(out('r'))
      expect(await readFile(out('r', 'a.txt'), 'utf8')).toBe('AAA')
      expect(await readFile(out('r', 'sub', 'b.txt'), 'utf8')).toBe('BBB')
      expect(await readFile(out('r', 'sub', 'deep', 'c.txt'), 'utf8')).toBe('CCC')
      // Several files are in flight at once — the reason this method has a pool
      // at all (a serial walk caps a folder at one file per round-trip).
      expect(stats.maxInFlight).toBeGreaterThan(1)
    })
  })

  it('keeps going when one file cannot be read (best effort)', async () => {
    const tree: FakeTree = {
      dirs: { '/r': [{ name: 'ok.txt', dir: false }, { name: 'bad.txt', dir: false }] },
      files: { '/r/ok.txt': { body: 'OK' }, '/r/bad.txt': { fail: true } }
    }
    await withTree(mgr, tree, async () => {
      await expect(mgr.downloadTree('s', '/r', base, 'r', true)).resolves.toBe(out('r'))
      expect(await readFile(out('r', 'ok.txt'), 'utf8')).toBe('OK')
      // A failed stream must not leave a half-written file behind.
      expect(await goneWithin(out('r', 'bad.txt'))).toBe(true)
    })
  })

  it('throws when every child of the folder failed', async () => {
    const tree: FakeTree = {
      dirs: { '/r': [{ name: 'x.txt', dir: false }, { name: 'y.txt', dir: false }] },
      files: { '/r/x.txt': { fail: true }, '/r/y.txt': { fail: true } }
    }
    await withTree(mgr, tree, async () => {
      await expect(mgr.downloadTree('s', '/r', base, 'r', true)).rejects.toThrow(/download-tree-empty/)
    })
  })

  it('throws when the ONLY loss is inside a nested folder', async () => {
    // The case a per-transfer counter lost. `r` has a single child, `sub`, and
    // every file under `sub` failed: the tree came down as an empty skeleton,
    // which is a failure, not a partial success. A walk that settles `sub`
    // before its parent registers it as an unaccounted child resolves here.
    const tree: FakeTree = {
      dirs: {
        '/r': [{ name: 'sub', dir: true }],
        '/r/sub': [{ name: 'only.txt', dir: false }]
      },
      files: { '/r/sub/only.txt': { fail: true } }
    }
    await withTree(mgr, tree, async () => {
      await expect(mgr.downloadTree('s', '/r', base, 'r', true)).rejects.toThrow(/download-tree-empty/)
    })
  })

  it('throws when the top folder itself cannot be listed', async () => {
    // prefetchDrag / edit staging read a resolved promise as "complete", so a
    // failed readdir on the requested path can never look like success.
    const tree: FakeTree = { dirs: {}, files: {} }
    await withTree(mgr, tree, async () => {
      await expect(mgr.downloadTree('s', '/gone', base, 'gone', true)).rejects.toThrow(/ENOENT/)
    })
  })

  it('still succeeds when a nested folder fails but siblings landed', async () => {
    // Deliberate parity with the serial version this replaced: one unreadable
    // subtree must not abandon a folder that is otherwise downloading.
    const tree: FakeTree = {
      dirs: {
        '/r': [
          { name: 'good.txt', dir: false },
          { name: 'dead', dir: true }
        ],
        '/r/dead': [{ name: 'x.txt', dir: false }]
      },
      files: { '/r/good.txt': { body: 'GOOD' }, '/r/dead/x.txt': { fail: true } }
    }
    await withTree(mgr, tree, async () => {
      await expect(mgr.downloadTree('s', '/r', base, 'r', true)).resolves.toBe(out('r'))
      expect(await readFile(out('r', 'good.txt'), 'utf8')).toBe('GOOD')
    })
  })

  it('drains a folder with no remote children as a legitimate empty dir', async () => {
    const tree: FakeTree = { dirs: { '/r': [] }, files: {} }
    await withTree(mgr, tree, async () => {
      await expect(mgr.downloadTree('s', '/r', base, 'r', true)).resolves.toBe(out('r'))
      expect(existsSync(out('r'))).toBe(true)
    })
  })

  it('downloads a single file through the same entry point', async () => {
    const tree: FakeTree = { dirs: {}, files: { '/f.txt': { body: 'SINGLE' } } }
    await withTree(mgr, tree, async () => {
      await expect(mgr.downloadTree('s', '/f.txt', base, 'f.txt', false)).resolves.toBe(out('f.txt'))
      expect(await readFile(out('f.txt'), 'utf8')).toBe('SINGLE')
    })
  })
})
