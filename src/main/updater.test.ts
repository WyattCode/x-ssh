import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  nextUpdateState,
  allowsAutoDownload,
  feedOverrideFromEnv,
  classifyUpdateError,
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

  it('checking → not-available → idle+fresh(带当前版本;重开面板显示「已是最新版本」)', () => {
    const s = nextUpdateState({ phase: 'checking' }, { type: 'not-available', latest: '0.8.0' })
    expect(s).toEqual({ phase: 'idle', fresh: true, latest: '0.8.0' })
  })

  it('error 可被迟到的 not-available 清掉(过期的「检查更新超时」不许滞留整个会话)', () => {
    const err = { phase: 'error' as const, error: 'update-check-timeout' }
    const s = nextUpdateState(err, { type: 'not-available', latest: '0.8.0' })
    expect(s).toEqual({ phase: 'idle', fresh: true, latest: '0.8.0' })
  })

  it('not-available 在其余相位一律被拒(checking/error 是仅有的两条来路)', () => {
    const dl = { phase: 'downloading' as const, latest: '0.9.0', percent: 50 }
    expect(nextUpdateState(dl, { type: 'not-available', latest: '0.8.0' })).toBe(dl)
    const avail = { phase: 'available' as const, latest: '0.9.0' }
    expect(nextUpdateState(avail, { type: 'not-available', latest: '0.8.0' })).toBe(avail)
    const idle = { phase: 'idle' as const }
    expect(nextUpdateState(idle, { type: 'not-available', latest: '0.8.0' })).toBe(idle)
    const down = { phase: 'downloaded' as const, latest: '0.8.0' }
    expect(nextUpdateState(down, { type: 'not-available', latest: '0.8.0' })).toBe(down)
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

  it('error 是万能出口;error 后可以重新 check', () => {
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
  })

  it('percent 夹在 0–100 并取整', () => {
    const from = { phase: 'available' as const, latest: '0.8.0' }
    expect(nextUpdateState(from, { type: 'progress', percent: -3 }).percent).toBe(0)
    expect(nextUpdateState(from, { type: 'progress', percent: 130.4 }).percent).toBe(100)
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
  // feed 覆盖只认这一个环境变量,只允许 https,且只在【未打包构建】生效。
  // 打包形态下它必须返回 undefined:electron-builder 26 不签更新清单,
  // 打包版接受覆盖 = 能设环境变量的人能让 Windows 静默安装任意代码。
  it('未打包 + 合法 https → 覆盖生效', () => {
    expect(
      feedOverrideFromEnv({ [FEED_URL_ENV]: 'https://mirror.example.com/xssh/' }, false)
    ).toBe('https://mirror.example.com/xssh/')
  })

  it('打包形态一律忽略(即使 env 是合法 https)', () => {
    expect(
      feedOverrideFromEnv({ [FEED_URL_ENV]: 'https://mirror.example.com/xssh/' }, true)
    ).toBeUndefined()
  })

  it('未设置 / 空串 → 无覆盖', () => {
    expect(feedOverrideFromEnv({}, false)).toBeUndefined()
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: '   ' }, false)).toBeUndefined()
  })

  it('http、file、伪 URL 一律拒绝(回退默认 GitHub Releases)', () => {
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: 'http://evil.example.com/' }, false)).toBeUndefined()
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: 'file:///tmp/feed' }, false)).toBeUndefined()
    expect(feedOverrideFromEnv({ [FEED_URL_ENV]: 'not a url' }, false)).toBeUndefined()
  })
})

describe('classifyUpdateError', () => {
  // 广播/回给 renderer 的 error 字段只能是这几个 kebab 码;异常原文只进主进程日志。
  const httpError = (message: string, statusCode?: number): Error =>
    Object.assign(new Error(message), statusCode === undefined ? {} : { statusCode })

  it('404(status 或 Cannot find channel 文本)→ update-channel-404', () => {
    expect(
      classifyUpdateError(
        httpError('Cannot find channel "latest-mac.yml" update info: HttpError: 404', 404)
      )
    ).toBe('update-channel-404')
    // 没有 statusCode 属性时靠消息特征兜底。
    expect(
      classifyUpdateError(
        new Error('Cannot find channel "latest.yml" not found. Headers: { "cf-ray": "abc" }')
      )
    ).toBe('update-channel-404')
  })

  it('403 / 429 / rate limit 文本 → update-rate-limited', () => {
    expect(classifyUpdateError(httpError('Too Many Requests', 429))).toBe('update-rate-limited')
    expect(classifyUpdateError(httpError('Forbidden', 403))).toBe('update-rate-limited')
    expect(classifyUpdateError(new Error("API rate limit exceeded for IP address"))).toBe(
      'update-rate-limited'
    )
  })

  it('超时(含 check() 自己抛的)→ update-check-timeout', () => {
    expect(classifyUpdateError(new Error('update check timed out after 20000 ms'))).toBe(
      'update-check-timeout'
    )
    expect(classifyUpdateError(Object.assign(new Error('socket'), { code: 'ETIMEDOUT' }))).toBe(
      'update-check-timeout'
    )
  })

  it('网络类(ENOTFOUND/ECONNRESET/ECONNREFUSED/TLS/getaddrinfo)→ update-network', () => {
    for (const msg of [
      'getaddrinfo ENOTFOUND github.com',
      'connect ECONNREFUSED 140.82.113.4:443',
      'socket hang up ECONNRESET',
      'unable to verify the first certificate',
      'self-signed certificate in certificate chain',
      'Client network socket disconnected before secure TLS connection was established'
    ]) {
      expect(classifyUpdateError(new Error(msg)), msg).toBe('update-network')
    }
  })

  it('未知异常一律 update-check-failed(原文绝不外流)', () => {
    expect(classifyUpdateError(new Error('Pickle in a blender at node_modules/weird/index.js'))).toBe(
      'update-check-failed'
    )
    expect(classifyUpdateError(undefined)).toBe('update-check-failed')
    expect(classifyUpdateError('some raw string')).toBe('update-check-failed')
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

  it('打包 + XSSH_UPDATE_FEED_URL → 忽略覆盖(绝不 setFeedURL),开发者日志写明原因', async () => {
    const a = fakeHost({ env: { [FEED_URL_ENV]: 'https://mirror.example.com/feed/' } })
    const logsA: string[] = []
    a.host.log = (m) => logsA.push(m)
    await createUpdater(a.host).start()
    expect(a.au.feedUrl).toBeUndefined()
    expect(
      logsA.some((m) => m.includes(FEED_URL_ENV) && /packaged/i.test(m) && /security|IGNORED/i.test(m))
    ).toBe(true)

    const b = fakeHost({ env: { [FEED_URL_ENV]: 'http://mirror.example.com/' } })
    const logsB: string[] = []
    b.host.log = (m) => logsB.push(m)
    await createUpdater(b.host).start()
    expect(b.au.feedUrl).toBeUndefined()
    expect(logsB.some((m) => m.includes(FEED_URL_ENV))).toBe(true)
  })

  it('检查超时(注入假时钟)→ update-check-timeout 码、注入 clearTimeoutFn 被调、释放 checking 后能重新查', async () => {
    // 假时钟:超时由用例手动触发,全程没有真定时器参与,消除时序脆弱;
    // checkTimeoutMs/setTimeoutFn/clearTimeoutFn 三个注入点都在此用例生效。
    let fireTimeout: (() => void) | null = null
    let timerSeq = 0
    const cleared: string[] = []
    const { host, au } = fakeHost({
      checkTimeoutMs: 1234,
      setTimeoutFn: (cb) => {
        fireTimeout = cb
        return `timer-${++timerSeq}`
      },
      clearTimeoutFn: (t) => {
        cleared.push(String(t))
      }
    })
    const armTimeout = (): (() => void) => {
      if (!fireTimeout) throw new Error('fake clock never armed (checkForUpdates path did not run)')
      return fireTimeout
    }
    const logs: string[] = []
    host.log = (m) => logs.push(m)
    const broadcasts: string[] = []
    host.broadcast = (s) => broadcasts.push(JSON.stringify(s))
    au.neverResolve = true
    const api = createUpdater(host)
    const p = api.check()
    // configuredOnce/checkForUpdates 全链路都是微任务:排干微任务直到假时钟挂上。
    for (let i = 0; i < 50 && !fireTimeout; i++) await Promise.resolve()
    armTimeout()()
    expect(await p).toEqual({ ok: false, error: 'update-check-timeout' })
    expect(api.state()).toEqual({ phase: 'error', error: 'update-check-timeout' })
    expect(broadcasts.some((b) => b.includes('update-check-timeout'))).toBe(true)
    // checkTimeoutMs 注入点真的进了超时路径(错误原文进日志)。
    expect(logs.some((m) => m.includes('1234'))).toBe(true)
    // 超时胜出后定时器也要经注入的 clearTimeoutFn 清掉(不留悬挂定时器)。
    expect(cleared).toEqual(['timer-1'])
    // checking 已释放:再查一次(这回会返回)必须真的重新调用 autoUpdater。
    // (真实 electron-updater 此际会对进行中的检查去重、不重发请求 —— 见 updater.ts
    //  check() 注释;假货不去重,本用例验的是我们这层 checking 闭包被释放。挂死
    //  未 settle 时再点「检查」会再吃一次超时,那是 electron-updater 的既定语义。)
    au.neverResolve = false
    const r2 = await api.check()
    expect(r2.ok).toBe(true)
    expect(au.checkCalls).toBe(2)
    expect(cleared).toEqual(['timer-1', 'timer-2'])
  })

  it('启动自动检查超时后,底层请求迟到确认「无更新」:迟到事件清掉过期 error,变 idle+fresh+当前版本', async () => {
    let fireTimeout: (() => void) | null = null
    const { host, au } = fakeHost({
      checkTimeoutMs: 1000,
      setTimeoutFn: (cb) => {
        fireTimeout = cb
        return 1
      },
      clearTimeoutFn: () => undefined
    })
    const armTimeout = (): (() => void) => {
      if (!fireTimeout) throw new Error('fake clock never armed (checkForUpdates path did not run)')
      return fireTimeout
    }
    au.neverResolve = true
    const api = createUpdater(host)
    const p = api.check()
    for (let i = 0; i < 50 && !fireTimeout; i++) await Promise.resolve()
    armTimeout()()
    expect(await p).toEqual({ ok: false, error: 'update-check-timeout' })
    expect(api.state()).toEqual({ phase: 'error', error: 'update-check-timeout' })
    // promise 早已按超时收尾,但 electron-updater 的事件仍会到:迟到的「无更新」
    // 必须把过期的检查错误清掉(整个会话不许停在 error,面板不该永远显示超时文案)。
    au.fire('update-not-available')
    expect(api.state()).toEqual({ phase: 'idle', fresh: true, latest: '0.7.1' }) // 0.7.1=fakeHost 当前版本
  })

  it('超时后挂起任务迟到 reject:不产生 unhandledRejection(updater.ts 的 pending.catch 保护)', async () => {
    let fireTimeout: (() => void) | null = null
    const { host, au } = fakeHost({
      checkTimeoutMs: 1000,
      setTimeoutFn: (cb) => {
        fireTimeout = cb
        return 1
      },
      clearTimeoutFn: () => undefined
    })
    au.neverResolve = true
    const api = createUpdater(host)
    const armTimeout = (): (() => void) => {
      if (!fireTimeout) throw new Error('fake clock never armed (checkForUpdates path did not run)')
      return fireTimeout
    }
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const p = api.check()
      for (let i = 0; i < 50 && !fireTimeout; i++) await Promise.resolve()
      armTimeout()()
      expect(await p).toEqual({ ok: false, error: 'update-check-timeout' })
      // 挂死的底层请求在超时之后才倒下 —— 迟到的 reject 不该变成 unhandledRejection。
      au.lateReject(new Error('late socket hang up after timeout'))
      // unhandledRejection 在当前宏任务收尾时才会被 Node 发出:等一个真宏任务。
      // (这是观察窗口,不是被断言的时序 —— 断言的是「没有」事件,多等只会更严。)
      await new Promise((r) => setTimeout(r, 50))
      expect(seen.map(String)).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('异常原文绝不进广播:广播里的 error 只有稳定码,全文只进日志', async () => {
    const { host, au } = fakeHost()
    const raw =
      'Cannot find channel "latest-mac.yml" update info: HttpError: 404 method: GET, ' +
      'response body: {"error":"Not Found"} Headers: { "cf-ray": "8f2a..." } at Object.<anonymous> ' +
      '(node_modules/electron-updater/out/providers/Provider.js:10)'
    au.throwOnCheck = Object.assign(new Error(raw), { statusCode: 404 })
    const broadcasts: string[] = []
    const logs: string[] = []
    host.broadcast = (s) => broadcasts.push(JSON.stringify(s))
    host.log = (m) => logs.push(m)
    const api = createUpdater(host)
    const r = await api.check()
    expect(r).toEqual({ ok: false, error: 'update-channel-404' })
    expect(api.state().error).toBe('update-channel-404')
    for (const b of broadcasts) {
      expect(b).not.toContain('HttpError')
      expect(b).not.toContain('at ')
      expect(b).not.toContain('node_modules')
      expect(b).not.toContain('cf-ray')
    }
    // 全文只出现在开发者日志里(给排查用)。
    expect(logs.some((m) => m.includes('HttpError') && m.includes('cf-ray'))).toBe(true)
  })

  it('autoCheckEnabled=false 时 start 不触发检查', async () => {
    const { host, au } = fakeHost({ autoCheckEnabled: async () => false })
    await createUpdater(host).start()
    expect(au.checkCalls).toBe(0)
  })

  it('checkForUpdates 抛错 → 分类成稳定码 + error 状态 + ok:false(原文不外流)', async () => {
    const { host } = fakeHost()
    const au = new FakeAutoUpdater()
    au.throwOnCheck = new Error('HTTP 404')
    host.loadAutoUpdater = async () => au
    const api = createUpdater(host)
    expect(await api.check()).toEqual({ ok: false, error: 'update-check-failed' })
    expect(api.state()).toEqual({ phase: 'error', error: 'update-check-failed' })
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

  it('模块里两种形状都没有 → check 返回 update-check-failed,可读原文只进日志', async () => {
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
    const logs: string[] = []
    host.log = (m) => logs.push(m)
    const api = createUpdater(host)
    const r = await api.check()
    expect(r.ok).toBe(false)
    expect(r.error).toBe('update-check-failed')
    // 不静默:开发者日志里有原始错误全文。
    expect(logs.some((m) => m.includes('autoUpdater'))).toBe(true)
  })
})

describe('package.json build.nsis — 产物命名与静默安装的配置钉死(0.8.2)', () => {
  // 0.8.1 两起实锤事故都是【配置层】的,所以断言也钉在配置层,防止改回去:
  // ① NSIS 默认产物名带空格,清单里走 space→连字符、GitHub 资产走 space→点号,
  //   清单指向的文件在发布物里不存在 → Windows 自动更新 100% 404;
  // ② oneClick:false 的辅助向导在退出安装被非静默形态拉起时弹三页向导要人点。
  // 0.8.2:artifactName 钉成无空格固定名(三种名字必然一致)+ oneClick:true(模板里
  // 根本没有可选页,任何形态都不弹向导)。升级位置不变:per-user 下 NSIS 从 HKCU
  // Software\<appId> 的 InstallLocation 读旧路径,%LOCALAPPDATA%\Programs\X-SSH 原地升级。
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    build?: { nsis?: Record<string, unknown>; mac?: { target?: unknown }; win?: Record<string, unknown> }
  }
  const nsis = (pkg.build?.nsis ?? {}) as Record<string, unknown>

  it('artifactName 无空格、含版本号、以 .exe 结尾(磁盘文件 == latest.yml == GitHub 资产名)', () => {
    expect(typeof nsis.artifactName).toBe('string')
    const name = nsis.artifactName as string
    expect(name).toContain('${version}') // 清单与产物都要带版本号
    expect(name).not.toMatch(/\s/) // 无空格 → electron-builder 两套 space 规范化不可能再分叉
    expect(name.endsWith('.exe')).toBe(true)
  })

  it('oneClick:true + allowToChangeInstallationDirectory:false(退出安装零向导)', () => {
    expect(nsis.oneClick).toBe(true)
    // electron-builder 对 oneClick:true + allowToChangeInstallationDirectory:true
    // 直接抛 InvalidConfigurationError,所以这里必须是显式 false(或省略)。
    expect(nsis.allowToChangeInstallationDirectory).toBe(false)
  })

  it('perMachine 未开:安装仍是 per-user(不许把老用户迁去 Program Files)', () => {
    expect(nsis.perMachine).toBeFalsy()
    expect(nsis.perMachineInstaller).toBeFalsy()
  })

  it('mac 不受影响:NSIS 只被 Windows 使用,mac 产物仍是 dmg+zip(自动更新策略在 updater.ts 另有断言)', () => {
    expect(pkg.build?.mac?.target).toEqual(['dmg', 'zip'])
    // win 仍是 nsis 单目标(ci.yml 的 release/*.exe 通配只会命中这一个 exe)。
    expect(pkg.build?.win?.target).toBe('nsis')
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
  /** true 时 checkForUpdates 永不 resolve(测超时路径)。 */
  neverResolve = false
  /** neverResolve 挂起的 reject 句柄:用例可手动让它在超时后迟到拒绝(lateReject)。 */
  private lateRejectFn: ((e: Error) => void) | null = null
  state: { phase: string } = { phase: 'idle' }
  private readonly listeners = new Map<string, Array<(arg?: unknown) => void>>()

  /** 用例手动触发事件(如超时后迟到的 update-not-available)。 */
  fire(event: string, arg?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(arg)
  }

  /** 模拟「挂死的底层请求在超时后才 reject」——迟到拒绝。 */
  lateReject(e: Error): void {
    if (!this.lateRejectFn) throw new Error('no hanging checkForUpdates in flight (neverResolve test setup missing)')
    this.lateRejectFn(e)
  }

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

  setFeedURL(config: { provider: 'generic'; url: string }): void {
    this.feedUrl = config.url
  }

  async checkForUpdates(): Promise<unknown> {
    this.checkCalls++
    if (this.throwOnCheck) {
      this.fire('error', this.throwOnCheck)
      throw this.throwOnCheck
    }
    if (this.neverResolve) {
      this.fire('checking-for-update')
      // 挂起但留 reject 句柄:用例可经 lateReject() 模拟超时后的迟到拒绝。
      return new Promise<never>((_resolve, reject) => {
        this.lateRejectFn = reject
      })
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
