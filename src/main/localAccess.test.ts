import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { LocalAccess } from './localAccess'
it('B13 requires native grants and rejects siblings and escaping symlinks', async () => {
  const dir = await mkdtemp(resolve('tmp-local/access-'))
  try {
    const root = join(dir, 'workspace'); await mkdir(root)
    const secret = join(dir, 'secret'); await writeFile(secret, 'private')
    await symlink(secret, join(root, 'link'))
    const access = new LocalAccess()
    expect(await access.allows(secret)).toBe(false)
    await access.grantDirectory(root)
    expect(await access.allows(join(root, 'new'))).toBe(true)
    expect(await access.allows(secret)).toBe(false)
    expect(await access.allows(join(root, 'link'))).toBe(false)
    await expect(access.assertTree(root)).rejects.toThrow('local-path-denied')
    access.clear()
    expect(await access.allows(root)).toBe(false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
it('B13 file selection grants exactly that file, not its siblings or a directory tree', async () => {
  const dir = await mkdtemp(resolve('tmp-local/access-file-'))
  try {
    const file = join(dir, 'picked'); await writeFile(file, 'ok'); await writeFile(join(dir, 'other'), 'no')
    const access = new LocalAccess(); await access.grantFile(file)
    expect(await access.allows(file)).toBe(true)
    expect(await access.allows(join(dir, 'other'))).toBe(false)
    expect(await access.allows(dir)).toBe(false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
it('B13 rejects a granted root replaced by a symlink and a new path beneath an escaping directory', async () => {
  const dir = await mkdtemp(resolve('tmp-local/access-swap-'))
  try {
    const root = join(dir, 'root'); const outside = join(dir, 'outside'); await mkdir(root); await mkdir(outside)
    const access = new LocalAccess(); await access.grantDirectory(root)
    await symlink(outside, join(root, 'escape'))
    expect(await access.allows(join(root, 'escape', 'new'))).toBe(false)
    await rm(root, { recursive: true }); await symlink(outside, root)
    expect(await access.allows(join(root, 'new'))).toBe(false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
