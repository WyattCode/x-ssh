import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Host } from '../shared/types'

// HostStore takes its folder from app.getPath at construction; point it at a
// fresh temp dir per test. No OS encryption in tests (secrets are skipped).
let dir = ''
vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { HostStore } = await import('./store')

const host = (id: string, name: string): Host => ({ id, name, host: `${name}.lan`, port: 22, username: 'u', auth: 'password' }) as unknown as Host
const hostsFile = (): string => join(dir, 'hosts.json')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-hosts-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('HostStore durability', () => {
  // 和设置丢失同一个毛病:hosts.json 写到一半,下次启动读成「没有主机」,
  // 随便一次保存(连接时的 touch)就把空列表写回去 —— 所有主机都没了。
  it('a half-written hosts.json is recovered from the backup', async () => {
    const first = new HostStore()
    await first.save(host('a', 'alpha'))
    await first.save(host('b', 'beta'))
    await writeFile(hostsFile(), '[\n  {"id": "a", "na', 'utf8')

    const next = new HostStore()
    expect((await next.list()).map((h) => h.id).sort()).toEqual(['a', 'b'])
    await next.touch('a')
    const saved = JSON.parse(await readFile(hostsFile(), 'utf8')) as Host[]
    expect(saved.map((h) => h.id).sort()).toEqual(['a', 'b'])
  })

  it('an unreadable host list with no backup is never overwritten with an empty list', async () => {
    await writeFile(hostsFile(), '[{"id": "a", "na', 'utf8')
    const store = new HostStore()
    expect(await store.list()).toEqual([])
    await store.touch('a') // no host found → nothing to persist
    await store.delete('zzz') // persists — must not blank the file
    expect(await readFile(hostsFile(), 'utf8')).toBe('[{"id": "a", "na')
  })

  it('saving a real host after an unreadable load does write (and keeps a .corrupt copy)', async () => {
    await writeFile(hostsFile(), '[{"id": "a", "na', 'utf8')
    const store = new HostStore()
    await store.save(host('c', 'gamma'))
    const saved = JSON.parse(await readFile(hostsFile(), 'utf8')) as Host[]
    expect(saved.map((h) => h.id)).toEqual(['c'])
    expect(await readFile(`${hostsFile()}.corrupt`, 'utf8')).toBe('[{"id": "a", "na')
  })
})
