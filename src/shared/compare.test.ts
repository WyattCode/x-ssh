import { describe, expect, it } from 'vitest'
import {
  compareCommands,
  compareCommandLabels,
  extractUsePercent,
  extractVersion,
  isValidService,
  inactiveNames,
  summarizeActive,
  summarizeCompare,
  summarizeMany
} from './compare'

describe('compare commands', () => {
  it('accepts ordinary service names and refuses anything that could reach the shell', () => {
    for (const ok of ['nginx', 'sshd', 'docker', 'foo@bar', 'my-app_1.service']) expect(isValidService(ok)).toBe(true)
    for (const bad of ['', ' nginx', 'ng inx', 'a;b', 'a&&b', '$(id)', '`id`', 'a|b', '../x', '-v', 'a'.repeat(49), 'a\nb', 7, null]) {
      expect(isValidService(bad)).toBe(false)
    }
    expect(() => compareCommands('service', 'a;b')).toThrow('invalid-service')
  })

  it('builds the fixed commands for each metric', () => {
    expect(compareCommands('service', 'nginx')).toEqual(['nginx -v 2>&1 | head -n 1', 'systemctl is-active nginx 2>&1 | head -n 1'])
    expect(compareCommands('disk', 'ignored;rm -rf /')).toEqual(['df -h / 2>&1 | tail -n 2', 'df -ih / 2>&1 | tail -n 2'])
    expect(compareCommandLabels('service', 'nginx')).toEqual(['nginx -v', 'systemctl is-active nginx'])
    expect(compareCommandLabels('disk', 'x')).toEqual(['df -h /', 'df -ih /'])
  })
})

describe('compare parsing', () => {
  it('pulls a version out of the usual banner shapes', () => {
    expect(extractVersion('nginx version: nginx/1.24.0')).toBe('1.24.0')
    expect(extractVersion('Docker version 27.1.1, build 6312585')).toBe('27.1.1')
    expect(extractVersion('OpenSSH_9.6p1 Ubuntu-3ubuntu13.5')).toBe('9.6')
    expect(extractVersion('nginx: invalid option: "v"')).toBeUndefined()
    expect(extractVersion(null)).toBeUndefined()
  })

  it('reads the root partition use percentage from df output', () => {
    expect(extractUsePercent('Filesystem  Size  Used Avail Use% Mounted on\n/dev/nvme0n1p2  200G  88G  112G  42% /')).toBe(42)
    expect(extractUsePercent('Filesystem  Inodes IUsed IFree IUse% Mounted on\n/dev/vda1 6.4M 256K 6.1M 4% /')).toBe(4)
    expect(extractUsePercent('df: command not found')).toBeUndefined()
    expect(extractUsePercent(null)).toBeUndefined()
  })
})

describe('compare summary', () => {
  const side = (name: string, outputs: (string | null)[]): { name: string; outputs: (string | null)[] } => ({ name, outputs })

  it('says which host is fuller and by how much', () => {
    const s = summarizeCompare('disk', side('edge', ['H\n/dev/a 200G 88G 112G 42% /']), side('stage', ['H\n/dev/b 100G 20G 76G 20% /']))
    expect(s).toEqual({ kind: 'disk', higher: 'edge', lower: 'stage', diff: 22 })
    const flipped = summarizeCompare('disk', side('stage', ['H\n/dev/b 100G 20G 76G 20% /']), side('edge', ['H\n/dev/a 200G 88G 112G 42% /']))
    expect(flipped).toMatchObject({ higher: 'edge', lower: 'stage', diff: 22 })
    expect(summarizeCompare('disk', side('a', ['x 30% /']), side('b', ['x 30% /']))).toEqual({ kind: 'diskSame' })
    expect(summarizeCompare('disk', side('a', [null]), side('b', ['x 30% /']))).toEqual({ kind: 'incomplete' })
  })

  it('compares versions and service state separately', () => {
    const a = side('edge', ['nginx version: nginx/1.24.0', 'active'])
    const b = side('stage', ['nginx version: nginx/1.26.2', 'active'])
    expect(summarizeCompare('service', a, b)).toMatchObject({ kind: 'version', same: false, a: '1.24.0', b: '1.26.2' })
    expect(summarizeCompare('service', a, { ...a, name: 'x' })).toMatchObject({ same: true })
    expect(summarizeActive(a, b)).toEqual({ kind: 'active', bothActive: true, inactive: [] })
    expect(summarizeActive(a, side('stage', ['n', 'inactive']))).toEqual({ kind: 'active', bothActive: false, inactive: ['stage'] })
    expect(summarizeCompare('service', side('a', [null, null]), side('b', [null, null]))).toEqual({ kind: 'incomplete' })
  })
})

describe('compare summary for three or more hosts', () => {
  const df = (pct: number) => `Filesystem Size Used Avail Use% Mounted on\n/dev/x 200G 88G 112G ${pct}% /`
  const side = (name: string, v: string | null, st: string | null, disk?: number) => ({
    name,
    outputs: disk !== undefined ? [df(disk), null] : [v ? `nginx/${v}` : null, st]
  })

  it('names the fullest and emptiest disk', () => {
    const s = summarizeMany('disk', [side('a', null, null, 42), side('b', null, null, 20), side('c', null, null, 77)])
    expect(s).toEqual({ kind: 'disk', same: false, high: { name: 'c', pct: 77 }, low: { name: 'b', pct: 20 } })
    expect(summarizeMany('disk', [side('a', null, null, 5), side('b', null, null, 5), side('c', null, null, 5)])).toMatchObject({ same: true })
    expect(summarizeMany('disk', [side('a', null, null, 5), { name: 'b', outputs: [null, null] }, side('c', null, null, 5)])).toEqual({ kind: 'incomplete' })
  })

  it('says whether every host runs the same version', () => {
    const same = summarizeMany('service', [side('a', '1.24.0', 'active'), side('b', '1.24.0', 'active'), side('c', '1.24.0', 'active')])
    expect(same).toMatchObject({ kind: 'version', same: true, v: '1.24.0' })
    const diff = summarizeMany('service', [side('a', '1.24.0', 'active'), side('b', '1.26.2', 'active'), side('c', '1.24.0', 'active')])
    expect(diff).toMatchObject({ kind: 'version', same: false })
    expect(summarizeMany('service', [side('a', null, null), side('b', null, null), side('c', null, null)])).toEqual({ kind: 'incomplete' })
  })

  it('lists the hosts whose service is not running', () => {
    expect(inactiveNames([side('a', '1', 'active'), side('b', '1', 'inactive'), side('c', '1', null)])).toEqual(['b', 'c'])
  })
})
