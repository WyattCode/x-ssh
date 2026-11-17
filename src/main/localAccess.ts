import { realpath, stat, readdir } from 'node:fs/promises'
import { dirname, basename, resolve, relative, isAbsolute, join } from 'node:path'

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

/** Resolve existing ancestors too: a new output beneath a symlink is not safe
 * merely because its final filename does not yet exist. */
async function canonical(path: string): Promise<string> {
  try { return await realpath(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(await canonical(parent), basename(path))
  }
}

/** Grants are created only from native selections, never renderer path claims.
 * Both lexical and canonical containment must hold; grants expire with the window. */
export class LocalAccess {
  private directories = new Map<string, string>()
  private files = new Map<string, string>()
  clear(): void { this.directories.clear(); this.files.clear() }
  async grantDirectory(path: string): Promise<void> {
    if (!(await stat(path)).isDirectory()) throw new Error('local-path-denied')
    this.directories.set(resolve(path), await realpath(path))
  }
  async grantFile(path: string): Promise<void> {
    if (!(await stat(path)).isFile()) throw new Error('local-path-denied')
    this.files.set(resolve(path), await realpath(path))
  }
  async grantOutputFile(path: string): Promise<void> {
    this.files.set(resolve(path), await canonical(path))
  }
  async allows(path: string): Promise<boolean> {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) return false
    try {
      const lexical = resolve(path)
      const actual = await canonical(lexical)
      if (this.files.get(lexical) === actual) return true
      for (const [root, realRoot] of this.directories) {
        if (inside(root, lexical) && inside(realRoot, actual) && await realpath(root) === realRoot) return true
      }
    } catch { /* Invalid and inaccessible paths are denied. */ }
    return false
  }
  async assert(path: string): Promise<void> {
    if (!await this.allows(path)) throw new Error('local-path-denied')
  }
  async assertTree(path: string): Promise<void> {
    const seen = new Set<string>()
    const visit = async (p: string): Promise<void> => {
      await this.assert(p)
      const info = await stat(p).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e })
      if (!info?.isDirectory()) return
      const real = await realpath(p)
      if (seen.has(real)) return
      seen.add(real)
      for (const name of await readdir(p)) await visit(join(p, name))
    }
    await visit(path)
  }
}
