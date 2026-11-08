import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createImeTrace,
  TRACE_FLAG,
  TRACE_LOG,
  TRACE_MAX_AGE_MS,
  TRACE_MAX_BYTES
} from './imeTrace'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-imetrace-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

describe('createImeTrace', () => {
  it('records nothing without the flag file', async () => {
    const t = createImeTrace(dir)
    t.write('{"a":1}')
    await t.flush()
    expect(await t.enabled()).toBe(false)
    expect(await exists(join(dir, TRACE_LOG))).toBe(false)
  })

  it('keeps lines in the order they were reported, even in a burst', async () => {
    await writeFile(join(dir, TRACE_FLAG), '')
    const t = createImeTrace(dir)
    for (let i = 0; i < 200; i++) t.write(`line ${i}`)
    await t.flush()
    const lines = (await readFile(join(dir, TRACE_LOG), 'utf8')).trim().split('\n')
    expect(lines).toEqual(Array.from({ length: 200 }, (_, i) => `line ${i}`))
  })

  it('ignores a flag file nobody touched for more than a day', async () => {
    await writeFile(join(dir, TRACE_FLAG), '')
    const later = Date.now() + TRACE_MAX_AGE_MS + 60_000
    const t = createImeTrace(dir, () => later)
    t.write('too late')
    await t.flush()
    expect(await t.enabled()).toBe(false)
    expect(await exists(join(dir, TRACE_LOG))).toBe(false)
  })

  it('cuts the log back once it passes the size cap', async () => {
    await writeFile(join(dir, TRACE_FLAG), '')
    await writeFile(join(dir, TRACE_LOG), 'x'.repeat(TRACE_MAX_BYTES + 10))
    const t = createImeTrace(dir)
    t.write('fresh')
    await t.flush()
    expect((await readFile(join(dir, TRACE_LOG), 'utf8')).trim()).toBe('fresh')
  })

  it('truncates a single oversized line', async () => {
    await writeFile(join(dir, TRACE_FLAG), '')
    const t = createImeTrace(dir)
    t.write('y'.repeat(10_000))
    await t.flush()
    expect((await readFile(join(dir, TRACE_LOG), 'utf8')).trim().length).toBe(4000)
  })
})
