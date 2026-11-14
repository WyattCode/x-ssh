import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir = ''
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { SshManager } = await import('./ssh')
const { KnownHosts } = await import('./knownHosts')

/** The job bookkeeping maps. Private at the type level only; the test reads
 *  them through an untyped handle — the whole point is what they hold after
 *  a failure exit. */
interface Bookkeeping {
  jobSession: Map<string, string>
  jobRate: Map<string, number>
  quietJobs: Set<string>
  cancelledJobs: Set<string>
  pausedJobs: Set<string>
  lastProgressAt: Map<string, number>
}
const book = (mgr: unknown): Bookkeeping =>
  mgr as unknown as Bookkeeping

const sender = {
  isDestroyed: () => false,
  send: vi.fn()
}

describe('syncJob cleanup on its failure exits', () => {
  let mgr: InstanceType<typeof SshManager>

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'xssh-sync-'))
    const kh = new KnownHosts()
    await kh.load()
    mgr = new SshManager(sender as never, kh)
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('drops every job mapping when the SFTP channel cannot open', async () => {
    // 'no-such-session' makes getSftp reject with 'session-missing' — the
    // first failure exit. The old catch deleted only `jobSession`: the rate
    // and quiet entries leaked, and a continuous-sync watcher hitting this
    // every pass would grow the sets without bound.
    const jobId = 'job-missing-session'
    await expect(
      mgr.syncJob('no-such-session', dir, '/remote', 'up', false, jobId, 2, 50_000, true)
    ).rejects.toThrow('session-missing')
    const b = book(mgr)
    expect(b.jobSession.has(jobId)).toBe(false)
    expect(b.jobRate.has(jobId)).toBe(false)
    expect(b.quietJobs.has(jobId)).toBe(false)
  })

  it('drops every job mapping when a side cannot be listed', async () => {
    // The second failure exit: a partial snapshot throws 'sync-list-failed'.
    // A remote dir that cannot be read stands in for a dead mount; the stub
    // keeps the test off the wire.
    const jobId = 'job-list-failed'
    const target = mgr as unknown as {
      getSftp: (id: string) => Promise<unknown>
      walkRemoteTree: () => Promise<boolean>
    }
    const realSftp = target.getSftp
    const realWalk = target.walkRemoteTree
    target.getSftp = async () => ({})
    target.walkRemoteTree = async () => false
    try {
      await expect(
        mgr.syncJob('some-session', dir, '/remote', 'both', true, jobId, 2, 50_000, true)
      ).rejects.toThrow('sync-list-failed')
    } finally {
      target.getSftp = realSftp
      target.walkRemoteTree = realWalk
    }
    const b = book(mgr)
    expect(b.jobSession.has(jobId)).toBe(false)
    expect(b.jobRate.has(jobId)).toBe(false)
    expect(b.quietJobs.has(jobId)).toBe(false)
    expect(b.cancelledJobs.has(jobId)).toBe(false)
    expect(b.pausedJobs.has(jobId)).toBe(false)
    expect(b.lastProgressAt.has(jobId)).toBe(false)
  })
})
