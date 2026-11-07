import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expandIncludes } from './sshConfigInclude'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-include-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('expandIncludes', () => {
  it('inlines a globbed include', async () => {
    await mkdir(join(dir, 'config.d'))
    await writeFile(join(dir, 'config.d', 'a.conf'), 'Host alpha\n  HostName 10.0.0.1\n')
    await writeFile(join(dir, 'config.d', 'b.conf'), 'Host beta\n  HostName 10.0.0.2\n')
    const out = await expandIncludes('Include config.d/*\n', dir)
    expect(out).toContain('Host alpha')
    expect(out).toContain('Host beta')
    expect(out).not.toContain('Include')
  })

  it('honours a suffix glob and sorts the result', async () => {
    await mkdir(join(dir, 'config.d'))
    await writeFile(join(dir, 'config.d', 'b.conf'), 'Host beta\n')
    await writeFile(join(dir, 'config.d', 'a.conf'), 'Host alpha\n')
    await writeFile(join(dir, 'config.d', 'notes.txt'), 'Host ignored\n')
    const out = await expandIncludes('Include config.d/*.conf\n', dir)
    expect(out.indexOf('alpha')).toBeLessThan(out.indexOf('beta'))
    expect(out).not.toContain('ignored')
  })

  it('accepts the Include=path spelling and quoting', async () => {
    await writeFile(join(dir, 'extra'), 'Host quoted\n')
    expect(await expandIncludes('Include="extra"\n', dir)).toContain('Host quoted')
    expect(await expandIncludes('include extra\n', dir)).toContain('Host quoted')
  })

  it('ignores a missing include like ssh does', async () => {
    const out = await expandIncludes('Host keepme\nInclude nope.d/*\n', dir)
    expect(out).toContain('Host keepme')
    expect(out).not.toContain('Include')
  })

  it('expands nested includes', async () => {
    await writeFile(join(dir, 'one'), 'Include two\nHost one\n')
    await writeFile(join(dir, 'two'), 'Host two\n')
    const out = await expandIncludes('Include one\n', dir)
    expect(out).toContain('Host one')
    expect(out).toContain('Host two')
  })

  it('does not loop forever on a cyclic include', async () => {
    await writeFile(join(dir, 'a'), 'Include b\nHost a\n')
    await writeFile(join(dir, 'b'), 'Include a\nHost b\n')
    const out = await expandIncludes('Include a\n', dir)
    expect(out).toContain('Host a')
    expect(out).toContain('Host b')
    // Each file is read at most once.
    expect(out.split('Host a').length - 1).toBe(1)
  })
})
