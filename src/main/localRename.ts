import { lstat, rename } from 'node:fs/promises'

/** Refuse existing entries, including dangling symlinks. */
export async function renameNoReplace(from: string, to: string): Promise<void> {
  if (from === to) return
  try {
    await lstat(to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await rename(from, to)
    return
  }
  throw new Error('target-exists')
}
