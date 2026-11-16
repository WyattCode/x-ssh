import { it, expect } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
it('B14 refuses an existing rename target without changing either file', async () => {
  const { renameNoReplace } = await import('./localRename')
  const dir = await mkdtemp(join(tmpdir(), 'xssh-rename-'))
  try {
    const a = join(dir, 'a'), b = join(dir, 'b')
    await writeFile(a, 'a'); await writeFile(b, 'b')
    await expect(renameNoReplace(a, b)).rejects.toThrow('target-exists')
    expect(await readFile(a, 'utf8')).toBe('a')
    expect(await readFile(b, 'utf8')).toBe('b')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
