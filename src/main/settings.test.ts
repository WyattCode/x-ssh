import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// settings.ts imports `app` from electron only for the default folder; tests pass a folder.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

// A switchable failure for the durable write, so the "disk full" path can be
// exercised on any platform (chmod on a directory is a no-op on Windows).
const durable = vi.hoisted(() => ({ failWrites: false }))
vi.mock('./durableFile', async (importOriginal) => {
  const real = (await importOriginal()) as typeof import('./durableFile')
  return {
    ...real,
    writeDurable: async (file: string, data: string) => {
      if (durable.failWrites) throw new Error('disk full')
      return real.writeDurable(file, data)
    }
  }
})

const { SettingsStore } = await import('./settings')

let dir: string
const file = (): string => join(dir, 'settings.json')
const bak = (): string => join(dir, 'settings.json.bak')
const readJson = async (p: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(p, 'utf8'))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'xssh-settings-'))
})
afterEach(async () => {
  durable.failWrites = false
  await rm(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('writes the main file and a matching backup', async () => {
    const s = new SettingsStore(dir)
    await s.set('externalEditor', 'C:\\\\Tools\\\\code.exe')
    expect(await readJson(file())).toEqual({ externalEditor: 'C:\\\\Tools\\\\code.exe' })
    expect(await readJson(bak())).toEqual({ externalEditor: 'C:\\\\Tools\\\\code.exe' })
  })

  // 用户报的「设置过一阵就丢」:上次退出时写到一半,settings.json 只剩半截;
  // 这次启动后随便存一项,原来是把只有这一项的内容写回去,其余全丢。
  it('a torn settings.json on startup does not wipe the other settings', async () => {
    const first = new SettingsStore(dir)
    await first.set('externalEditor', 'code.exe')
    await first.set('snippets', [{ id: '1', title: 'gpu', text: 'nvidia-smi' }])
    await first.set('lang', 'zh')

    // 进程在改写 settings.json 的半路被结束。
    await writeFile(file(), '{\n  "externalEditor": "co', 'utf8')

    const next = new SettingsStore(dir)
    expect(await next.get('externalEditor')).toBe('code.exe')
    await next.set('openTabs', [])
    const saved = await readJson(file())
    expect(saved.externalEditor).toBe('code.exe')
    expect(saved.snippets).toEqual([{ id: '1', title: 'gpu', text: 'nvidia-smi' }])
    expect(saved.lang).toBe('zh')
    // 读不出来的那份留着备查。
    await expect(access(`${file()}.corrupt`)).resolves.toBeUndefined()
  })

  it('an empty settings.json falls back to the backup too', async () => {
    const first = new SettingsStore(dir)
    await first.set('externalEditor', 'code.exe')
    await writeFile(file(), '', 'utf8')
    expect(await new SettingsStore(dir).get('externalEditor')).toBe('code.exe')
  })

  it('a missing main file with a backup present recovers from the backup', async () => {
    const first = new SettingsStore(dir)
    await first.set('externalEditor', 'code.exe')
    await rm(file())
    expect(await new SettingsStore(dir).get('externalEditor')).toBe('code.exe')
  })

  it('first run starts empty', async () => {
    const s = new SettingsStore(dir)
    expect(await s.get('externalEditor')).toBeUndefined()
  })

  it('keeps keys another instance wrote in the meantime', async () => {
    const a = new SettingsStore(dir)
    const b = new SettingsStore(dir)
    await a.set('externalEditor', 'code.exe')
    await b.get('lang') // b loads now, sees the editor
    await a.set('lang', 'en')
    await b.set('zoom', 1.1) // b must re-read, not write back its stale copy
    const saved = await readJson(file())
    expect(saved).toMatchObject({ externalEditor: 'code.exe', lang: 'en', zoom: 1.1 })
  })

  it('flush waits for queued writes', async () => {
    const s = new SettingsStore(dir)
    void s.set('windowBounds', { width: 1200, height: 800, maximized: false })
    await s.flush()
    expect((await readJson(file())).windowBounds).toEqual({ width: 1200, height: 800, maximized: false })
  })

  // 写盘失败必须让调用方(IPC)看到,而不是记一条日志就当成功 —— 否则界面乐观
  // 更新了、下次启动又变回旧值。同时一次失败不能把后面的写全堵死。
  it('a write failure rejects the caller but does not poison later sets', async () => {
    const s = new SettingsStore(dir)
    await s.set('lang', 'zh')
    durable.failWrites = true
    await expect(s.set('zoom', 1.2)).rejects.toBeTruthy()
    durable.failWrites = false
    // flush() 只等队列,不该把上一次的失败再抛一遍。
    await expect(s.flush()).resolves.toBeUndefined()
    await s.set('lang', 'en')
    expect(await s.get('lang')).toBe('en')
    expect((await readJson(file())).lang).toBe('en')
  })

  it('clearing a value removes the key', async () => {
    const s = new SettingsStore(dir)
    await s.set('externalEditor', 'code.exe')
    await s.set('externalEditor', '')
    expect(await readJson(file())).toEqual({})
  })
})
