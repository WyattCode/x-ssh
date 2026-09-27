import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, access, readdir, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseJson, readDurable, sweepTemps, writeDurable } from './durableFile'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-durable-'))
  file = join(dir, 'data.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('durable file', () => {
  it('writes the file and an identical backup, no temp left behind', async () => {
    await writeDurable(file, '{"a":1}')
    expect(await readFile(file, 'utf8')).toBe('{"a":1}')
    expect(await readFile(`${file}.bak`, 'utf8')).toBe('{"a":1}')
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('reads the backup when the main file was cut off mid-write', async () => {
    await writeDurable(file, '{"hosts":[1,2,3]}')
    await writeFile(file, '{"hosts":[1,', 'utf8')
    const r = await readDurable(file, parseJson)
    expect(r).toEqual({ status: 'ok', value: { hosts: [1, 2, 3] }, fromBackup: true })
    await expect(access(`${file}.corrupt`)).resolves.toBeUndefined()
  })

  it('an empty main file counts as unreadable, not as empty data', async () => {
    await writeDurable(file, '{"a":1}')
    await writeFile(file, '', 'utf8')
    expect(await readDurable(file, parseJson)).toMatchObject({ status: 'ok', value: { a: 1 } })
  })

  it('missing on first run', async () => {
    expect(await readDurable(file, parseJson)).toEqual({ status: 'missing' })
  })

  it('bad when the file and its backup are both unreadable', async () => {
    await writeFile(file, '{', 'utf8')
    await writeFile(`${file}.bak`, '', 'utf8')
    expect(await readDurable(file, parseJson)).toEqual({ status: 'bad' })
  })

  it('concurrent writes to one file end with the last one, both files complete', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeDurable(file, JSON.stringify({ i }))))
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ i: 19 })
    expect(JSON.parse(await readFile(`${file}.bak`, 'utf8'))).toEqual({ i: 19 })
  })

  it('sweeps stale temp files but not fresh ones or unrelated files', async () => {
    const stale = `${file}.1234.tmp`
    const fresh = `${file}.5678.tmp`
    const other = join(dir, 'other.json.1234.tmp')
    await writeFile(stale, 'x')
    await writeFile(fresh, 'x')
    await writeFile(other, 'x')
    const old = new Date(Date.now() - 5 * 60_000)
    await utimes(stale, old, old)
    await utimes(other, old, old)
    await sweepTemps(file)
    const left = await readdir(dir)
    expect(left).not.toContain('data.json.1234.tmp')
    expect(left).toContain('data.json.5678.tmp')
    expect(left).toContain('other.json.1234.tmp')
  })
})
