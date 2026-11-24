import { describe, it, expect } from 'vitest'
import {
  nextUpdateState,
  allowsAutoDownload,
  hasNewerVersion,
  feedOverrideFromEnv,
  toCheckResult,
  createUpdater,
  resolveAutoUpdater,
  FEED_URL_ENV,
  type AutoUpdaterLike,
  type UpdaterHost
} from './updater'

// updater.ts 顶层不 import electron:纯函数直接测,接线用注入的假 autoUpdater。

describe('nextUpdateState', () => {
  it('idle → checking → available → downloading → downloaded', () => {
    let s = nextUpdateState({ phase: 'idle' }, { type: 'check' })
    expect(s.phase).toBe('checking')
    s = nextUpdateState(s, { type: 'available', version: '0.8.0', url: 'u' })
    expect(s).toEqual({ phase: 'available', latest: '0.8.0', url: 'u' })
    s = nextUpdateState(s, { type: 'progress', percent: 42.6 })
    expect(s).toMatchObject({ phase: 'downloading', percent: 43, latest: '0.8.0' })
    s = nextUpdateState(s, { type: 'downloaded', version: '0.8.0', url: 'u' })
    expect(s.phase).toBe('downloaded')
  })

  it('checking → not-available 回到 idle(干净状态,不带残留版本)', () => {
    let s = nextUpdateState({ phase: 'checking' }, { type: 'not-available' })
    expect(s).toEqual({ phase: 'idle' })
  })

  it('检查/下载进行中不允许重入 check', () => {
    const checking = { phase: 'checking' as const }
    expect(nextUpdateState(checking, { type: 'check' })).toBe(checking)
    const dl = { phase: 'downloading' as const, latest: '0.8.0', percent: 10 }
    expect(nextUpdateState(dl, { type: 'check' })).toBe(dl)
  })

  it('乱序事件保持原状态(idle 收到 progress;idle 收到 downloaded)', () => {
    const idle = { phase: 'idle' as const }
    expect(nextUpdateState(idle, { type: 'progress', percent: 50 })).toBe(idle)
    expect(nextUpdateState(idle, { type: 'downloaded', version: '0.8.0' })).toBe(idle)
    // 未先收到 available 的 progress 也拒(idle 状态);available→progress 才转 downloading
  })

  it('error 是万能出口;error 后可以重新 check;reset 回 idle', () => {
    for (const phase of ['idle', 'checking', 'available', 'downloading', 'downloaded'] as const) {
      const s = nextUpdateState({ phase }, { type: 'error', message: 'boom' })
      expect(s).toEqual({ phase: 'error', error: 'boom' })
    }
    // 同一条错误事件不再广播第二次(事件回调与 check() catch 会各报一次)。
    const err = { phase: 'error' as const, error: 'boom' }
    expect(nextUpdateState(err, { type: 'error', message: 'boom' })).toBe(err)
    // 换了消息才更新。
    expect(nextUpdateState(err, { type: 'error', message: 'other' }).error).toBe('other')
    const back = nextUpdateState({ phase: 'error', error: 'boom' }, { type: 'check' })
    expect(back.phase).toBe('checking')
    expect(nextUpdateState({ phase: 'downloaded' }, { type: 'reset' })).toEqual({ phase: 'idle' })
  })

  it('percent 夹在 0–100 并取整', () => {
    const from = { phase: 'available' as const, latest: '0.8.0' }
    expect(nextUpdateState(from, { type: 'progress', percent: -3 }).percent).toBe(0)
    expect(nextUpdateState(from, { type: 'progress', percent: 130.4 }).percent).toBe(100)
  })
})

describe('hasNewerVersion', () => {
  it('严格大于才算新版本', () => {
    expect(hasNewerVersion('0.7.1', '0.8.0')).toBe(true)
    expect(hasNewerVersion('0.7.1', '0.7.1')).toBe(false)
    expect(hasNewerVersion('0.8.0', '0.7.1')).toBe(false)
  })
})

describe('allowsAutoDownload', () => {
  // 产品拍板:只有打包的 Windows 自动下载+退出时安装。mac 是 ad-hoc 签名,
  // Squirrel.Mac 校验同一 Team ID,自动替换会静默失败,必须停在“提示”这一步。
  it('打包的 win32 允许;mac / 开发模式 / linux 不允许', () => {
    expect(allowsAutoDownload('win32', true)).toBe(true)
    expect(allowsAutoDownload('darwin', true)).toBe(false)
    expect(allowsAutoDownload('linux', true)).toBe(false)
    expect(allowsAutoDownload('win32', false)).toBe(false)
  })
})

describe('feedOverrideFromEnv', () => {
  // feed 覆盖只认这一个环境变量,且只允许 https;它永远不能关掉 sha512 校验。
  it('仅接受合法的 https 地址', () => {
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: 'https://mirror.example.com/xssh/' })).toBe(
      'https://mirror.example.com/xssh/'
    )
  })

  it('未设置 / 空串 → 无覆盖', () => {
    expect(feedOverrideFromEnv({})).toBeUndefined()
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: '   ' })).toBeUndefined()
  })

  it('http、file、伪 URL 一律拒绝(回退默认 GitHub Releases)', () => {
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: 'http://evil.example.com/' })).toBeUndefined()
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: 'file:///tmp/feed' })).toBeUndefined()
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: 'not a url' })).toBeUndefined()
  })
})

describe('toCheckResult', () => {
  const url = (v: string): string => `https://github.com/WyattCode/x-ssh/releases/tag/v${v}`
  it('idle = 已是最新(fresh)', () => {
    expect(toCheckResult({ phase: 'idle' }, '0.7.1', url)).toEqual({
      ok: true,
      fresh: true,
      current: '0.7.1',
      latest: '0.7.1',
      url: url('0.7.1')
    })
  })
  it('available 带新版本号与发布页', () => {
    const r = toCheckResult({ phase: 'available', latest: '0.8.0', url: url('0.8.0') }, '0.7.1', url)
    expect(r).toMatchObject({ ok: true, fresh: false, latest: '0.8.0', url: url('0.8.0') })
  })
  it('缺 url 时用 releasesUrl 兜底', () => {
    const r = toCheckResult({ phase: 'downloaded', latest: '0.8.0' }, '0.7.1', url)
    expect(r.url).toBe(url('0.8.0'))
  })
  it('error → ok:false 带错误', () => {
    expect(toCheckResult({ phase: 'error', error: 'boom' }, '0.7.1', url)).toEqual({
      ok: false,
      error: 'boom'
    })
  })
})

describe('createUpdater(注入假 autoUpdater)', () => {
  function fakeHost(over: Partial<UpdaterHost> = {}): { host: UpdaterHost; au: FakeAutoUpdater } {
    const au = new FakeAutoUpdater()
    const host: UpdaterHost = {
      isPackaged: true,
      platform: 'win32',
      currentVersion: '0.7.1',
      env: {},
      releasesUrl: (v) => `tag/${v}`,
      autoCheckEnabled: async () => true,
      broadcast: () => undefined,
      log: () => undefined,
      loadAutoUpdater: async () => au,
      ...over
    }
    return { host, au }
  }

  it('未打包:check 返回 update-dev-mode,根本不碰 autoUpdater', async () => {
    const { host, au } = fakeHost({ isPackaged: false })
    const api = createUpdater(host)
    expect(await api.check()).toEqual({ ok: false, error: 'update-dev-mode' })
    expect(au.checkCalls).toBe(0)
    // start() 也必须短路
    await api.start()
    expect(au.checkCalls).toBe(0)
  })

  it('打包 + not-available → fresh;available → 发布页 url', async () => {
    const { host, au } = fakeHost()
    const api = createUpdater(host)
    au.nextResult = 'none'
    expect(await api.check()).toMatchObject({ ok: true, fresh: true, current: '0.7.1' })
    au.nextResult = 'available'
    expect(await api.check()).toMatchObject({ ok: true, fresh: false, latest: '9.9.9', url: 'tag/9.9.9' })
  })

  it('Windows 自动下载开;mac 关(且 mac 检查到 available 也不会下载)', async () => {
    const win = fakeHost()
    win.au.nextResult = 'available'
    await createUpdater(win.host).check()
    expect(win.au.autoDownload).toBe(true)
    expect(win.au.downloadCalls).toBe(1) // Windows:autoDownload=true,更新包后台下载

    const mac = fakeHost({ platform: 'darwin' })
    mac.au.nextResult = 'available'
    const r = await createUpdater(mac.host).check()
    expect(mac.au.autoDownload).toBe(false)
    expect(mac.au.autoInstallOnAppQuit).toBe(false)
    expect(r).toMatchObject({ ok: true, fresh: false, latest: '9.9.9' })
    expect(mac.au.state.phase).toBe('available')
  })

  it('XSSH_UPDATE_FEED_URL(https)→ setFeedURL + 醒目日志;非 https 被忽略且留日志', async () => {
    const a = fakeHost({ env: { [FEED_URL_ENV]: 'https://mirror.example.com/feed/' } })
    const logsA: string[] = []
    a.host.log = (m) => logsA.push(m)
    await createUpdater(a.host).start()
    expect(a.au.feedUrl).toBe('https://mirror.example.com/feed/')
    expect(logsA.some((m) => m.includes(FEED_URL_ENV))).toBe(true)

    const b = fakeHost({ env: { [FEED_URL_ENV]: 'http://mirror.example.com/' } })
    const logsB: string[] = []
    b.host.log = (m) => logsB.push(m)
    await createUpdater(b.host).start()
    expect(b.au.feedUrl).toBeUndefined()
    expect(logsB.some((m) => m.includes(FEED_URL_ENV))).toBe(true)
  })

  it('autoCheckEnabled=false 时 start 不触发检查', async () => {
    const { host, au } = fakeHost({ autoCheckEnabled: async () => false })
    await createUpdater(host).start()
    expect(au.checkCalls).toBe(0)
  })

  it('checkForUpdates 抛错 → error 状态 + ok:false', async () => {
    const { host } = fakeHost()
    const au = new FakeAutoUpdater()
    au.throwOnCheck = new Error('HTTP 404')
    host.loadAutoUpdater = async () => au
    const api = createUpdater(host)
    expect(await api.check()).toEqual({ ok: false, error: 'HTTP 404' })
    expect(api.state().phase).toBe('error')
  })
})

describe('resolveAutoUpdater(CJS 模块形状)', () => {
  // 打包后 `await import('electron-updater')` 拿到的是 CJS 命名空间:autoUpdater
  // 可能挂在顶层,也可能只在 .default 上(实测打包 mac 里只有 .default,直接
  // `.autoUpdater` 得到 undefined,第一行就 "Cannot read properties of undefined")。
  // 这条测试同时喂两种形状,断言拿回的是同一个对象。
  function fakeInstance(): AutoUpdaterLike {
    return {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      setFeedURL: () => undefined,
      checkForUpdates: async () => undefined,
      quitAndInstall: () => undefined,
      on: () => undefined
    }
  }

  it('顶层具名导出形状 → 返回该实例', () => {
    const au = fakeInstance()
    expect(resolveAutoUpdater({ autoUpdater: au })).toBe(au)
  })

  it('只有 default 导出的 CJS 形状 → 返回 .default.autoUpdater(同一对象)', () => {
    const au = fakeInstance()
    expect(resolveAutoUpdater({ default: { autoUpdater: au } })).toBe(au)
  })

  it('两种形状返回同一个对象(归一化后不分彼此)', () => {
    const au = fakeInstance()
    expect(resolveAutoUpdater({ autoUpdater: au })).toBe(resolveAutoUpdater({ default: { autoUpdater: au } }))
  })

  it('两种形状都拿不到 → 抛出可读英文错误,绝不返回 undefined', () => {
    expect(() => resolveAutoUpdater({})).toThrow(/autoUpdater/)
    expect(() => resolveAutoUpdater({ default: {} })).toThrow(/electron-updater/)
    expect(() => resolveAutoUpdater(null)).toThrow(/autoUpdater/)
    expect(() => resolveAutoUpdater({ default: { autoUpdater: { nope: 1 } } })).toThrow(/autoUpdater/)
  })

  it('createUpdater 走 default-only 模块形状也能完成配置与检查(原始 bug 的接线路径)', async () => {
    const au = new FakeAutoUpdater()
    au.nextResult = 'available'
    const host: UpdaterHost = {
      isPackaged: true,
      platform: 'win32',
      currentVersion: '0.7.1',
      env: {},
      releasesUrl: (v) => `tag/${v}`,
      autoCheckEnabled: async () => true,
      broadcast: () => undefined,
      log: () => undefined,
      // 打包实测形状:命名导出不可见,只有 default。
      loadAutoUpdaterModule: async () => ({ default: { autoUpdater: au } })
    }
    const r = await createUpdater(host).check()
    expect(au.checkCalls).toBe(1)
    expect(au.autoDownload).toBe(true)
    expect(r).toMatchObject({ ok: true, fresh: false, latest: '9.9.9' })
  })

  it('模块里两种形状都没有 → check 返回 ok:false 带可读错误,不静默', async () => {
    const host: UpdaterHost = {
      isPackaged: true,
      platform: 'win32',
      currentVersion: '0.7.1',
      env: {},
      releasesUrl: (v) => `tag/${v}`,
      autoCheckEnabled: async () => true,
      broadcast: () => undefined,
      log: () => undefined,
      loadAutoUpdaterModule: async () => ({ weird: true })
    }
    const api = createUpdater(host)
    const r = await api.check()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/autoUpdater/)
  })
})

class FakeAutoUpdater implements AutoUpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  feedUrl: string | undefined
  checkCalls = 0
  downloadCalls = 0
  quitAndInstallCalls = 0
  nextResult: 'none' | 'available' = 'none'
  throwOnCheck: Error | null = null
  state: { phase: string } = { phase: 'idle' }
  private readonly listeners = new Map<string, Array<(arg?: unknown) => void>>()

  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void {
    this.quitAndInstallCalls++
    void isSilent
    void isForceRunAfter
  }

  on(event: string, cb: (arg?: unknown) => void): void {
    const arr = this.listeners.get(event) ?? []
    arr.push(cb)
    this.listeners.set(event, arr)
  }

  private fire(event: string, arg?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(arg)
  }

  setFeedURL(config: { provider: 'generic'; url: string }): void {
    this.feedUrl = config.url
  }

  async checkForUpdates(): Promise<unknown> {
    this.checkCalls++
    if (this.throwOnCheck) {
      this.fire('error', this.throwOnCheck)
      throw this.throwOnCheck
    }
    this.fire('checking-for-update')
    this.state.phase = 'checking'
    if (this.nextResult === 'available') {
      this.fire('update-available', { version: '9.9.9' })
      this.state.phase = 'available'
      if (this.autoDownload) {
        this.downloadCalls++
        this.fire('download-progress', { percent: 55 })
        this.fire('update-downloaded', { version: '9.9.9' })
      }
    } else {
      this.fire('update-not-available')
      this.state.phase = 'idle'
    }
    return { updateInfo: { version: '9.9.9' } }
  }
}
