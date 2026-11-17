import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
it('B13 uses a sandboxed window with a CommonJS preload and IPC clipboard', () => {
  const main = readFileSync('src/main/index.ts', 'utf8')
  const preload = readFileSync('src/preload/index.ts', 'utf8')
  const config = readFileSync('electron.vite.config.ts', 'utf8')
  expect(main).toContain('sandbox: true')
  expect(main).toContain('../preload/index.cjs')
  expect(config).toContain("format: 'cjs'")
  expect(preload).not.toContain('clipboard.readText()')
  expect(preload).not.toContain('clipboard.writeText(text)')
})
