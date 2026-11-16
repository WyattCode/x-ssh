import { it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ssh2 from 'ssh2'
import { KeyManager } from './keyManager'
it('B21 generates asynchronously without invoking synchronous key generation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xssh-key-'))
  const sync = vi.spyOn(ssh2.utils, 'generateKeyPairSync')
  try {
    await new KeyManager(dir).generate({ name: 'test' })
    expect(sync).not.toHaveBeenCalled()
  } finally { sync.mockRestore(); await rm(dir, { recursive: true, force: true }) }
})
it('B21 bounds concurrent key descriptions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xssh-keys-'))
  try {
    await mkdir(join(dir, 'keys'))
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFile(join(dir, 'keys', `${i}`), 'key')))
    const mgr = new KeyManager(dir) as any
    let active = 0, max = 0
    mgr.describe = async () => { max = Math.max(max, ++active); await new Promise(r => setTimeout(r, 5)); active--; return { id: 'a' } }
    await mgr.list()
    expect(max).toBeLessThanOrEqual(2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
