/**
 * electron-updater 封装:更新状态机 + 一次性接线。
 *
 * 更新源 = 本仓库的 GitHub Releases(WyattCode/x-ssh,见 package.json build.publish),
 * 不自架服务器。feed 地址只允许通过环境变量 XSSH_UPDATE_FEED_URL 覆盖
 * (feedOverrideFromEnv),且【只在未打包构建中生效】—— electron-builder 26 不签
 * 更新清单(Ed25519 清单签名是 v27 才有),客户端只校验清单自述的 sha512,所以
 * 打包形态若接受这个覆盖,等于“能设环境变量的人 = 能让 Windows 静默下载安装任意
 * 代码”。打包形态一律用默认 GitHub Releases,env 的存在只打进开发者日志。
 * 覆盖只改「从哪拉清单」,产物 sha512 始终按清单校验 —— 这里没有任何“跳过校验”的开关。
 *
 * 信任模型(如实,不粉饰):包未 Authenticode 签名,更新清单(latest.yml)也没有
 * 清单签名(electron-builder 26 不签清单,清单签名/Ed25519 是 v27 才引入的)。
 * 因此信任锚点只有两条:①清单与产物只从我们自己的 GitHub Releases 拉;
 * ②electron-updater 对每个下载产物做 sha512 比对。Windows 上因此必须
 * win.verifyUpdateCodeSignature=false(见 package.json build.win)——未签名包过不了
 * electron-updater 默认的 publisherName/Authenticode 校验,开着它等于永远拒装。
 *
 * 平台策略(产品拍板):
 * - Windows:允许自动下载,装在下一次退出时(autoInstallOnAppQuit)。
 * - macOS:ad-hoc 签名,Squirrel.Mac 要求更新包与运行中 app 同一 Team ID,自动替换
 *   会静默失败 —— 所以 mac 只做「检查到新版本 → 提示 → 用户打开发布页覆盖安装」,
 *   永不触发 downloadUpdate()/quitAndInstall()(autoDownload=false 保证这点)。
 *
 * 本文件顶层不 import electron / electron-updater(单测直接跑纯函数);
 * electron-updater 只在打包形态真正要跑时才动态载入,测试用 loadAutoUpdater 注入假货。
 */
import type { AppUpdateState } from '../shared/ipc'

/** 唯一的 feed 覆盖入口(仅 https,且仅未打包构建)。除它以外没有任何校验降级开关。 */
export const FEED_URL_ENV = 'XSSH_UPDATE_FEED_URL'

/** 手动/自动检查更新的硬超时:超时只解除界面阻塞(释放我们自己的 checking 闭包),
 *  不能取消底层请求(electron-updater 对 checkForUpdates 去重,见 check() 内注释)。 */
export const UPDATE_CHECK_TIMEOUT_MS = 20_000

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'available'; version: string; url?: string }
  /** 「无更新」;latest=当前版本(fresh 态要拿它做「已是最新版本 X」展示)。 */
  | { type: 'not-available'; latest?: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string; url?: string }
  | { type: 'error'; message: string }

/**
 * 纯状态机。非法/乱序迁移保持原状态不变(electron-updater 的事件顺序不总如预期,
 * 例如 progress 可能先于已处理的 available 到达)。error 是万能出口。
 */
export function nextUpdateState(s: AppUpdateState, ev: UpdateEvent): AppUpdateState {
  switch (ev.type) {
    case 'check':
      // 检查/下载进行中不重入。
      return s.phase === 'checking' || s.phase === 'downloading' ? s : { phase: 'checking' }
    case 'available':
      return s.phase === 'checking' || s.phase === 'idle' || s.phase === 'error'
        ? { phase: 'available', latest: ev.version, url: ev.url }
        : s
    case 'not-available': {
      // 「无更新」的合法来路两条:① checking 的正常收尾;② 启动自动检查超时(已记
      // error)之后,底层请求稍后才回来确认「无更新」—— 迟到的结果必须清掉过期的
      // 检查错误,否则主进程整个会话停在 error,设置面板每次回读都显示「检查更新超时」。
      // fresh=true + latest=当前版本:重开面板也能显示「已是最新版本 X」(见 ipc.ts)。
      if (s.phase !== 'checking' && s.phase !== 'error') return s
      const next: AppUpdateState = { phase: 'idle', fresh: true }
      if (ev.latest) next.latest = ev.latest
      return next
    }
    case 'progress': {
      if (s.phase !== 'downloading' && s.phase !== 'available') return s
      const percent = Math.max(0, Math.min(100, Math.round(ev.percent)))
      return { ...s, phase: 'downloading', percent }
    }
    case 'downloaded':
      return s.phase === 'checking' || s.phase === 'available' || s.phase === 'downloading'
        ? { phase: 'downloaded', latest: ev.version, url: ev.url }
        : s
    case 'error':
      // 同一条错误不重复广播(electron-updater 的 'error' 事件与 check() 的
      // catch 会对同一次失败各报一次)。
      return s.phase === 'error' && s.error === ev.message ? s : { phase: 'error', error: ev.message }
  }
}

/**
 * 只有打包后的 Windows 允许「自动下载 + 退出时安装」。
 * mac 见文件头的 Team ID 说明;linux 没有发布通道;开发模式没有 app-update.yml,
 * electron-updater 会直接抛 ENOENT,所以一律不跑。
 */
export function allowsAutoDownload(platform: NodeJS.Platform, isPackaged: boolean): boolean {
  return isPackaged && platform === 'win32'
}

/**
 * feed 覆盖判定:仅接受 XSSH_UPDATE_FEED_URL 给出的合法 https 地址,且仅在
 * 【未打包构建】(isPackaged=false)生效。打包形态一律返回 undefined(= 默认
 * GitHub Releases):electron-builder 26 不签更新清单,客户端只校验清单自述的
 * sha512 —— 打包版若接受覆盖,任何能设环境变量的人都能让 Windows 静默下载并
 * 安装任意代码。未设 / 空 / 非 https(含 file://、http://)一律回退默认源。
 * 这个覆盖永远不可能关闭 sha512 校验 —— 代码里根本不存在那样的开关。
 */
export function feedOverrideFromEnv(
  env: Record<string, string | undefined>,
  isPackaged: boolean
): string | undefined {
  if (isPackaged) return undefined
  const raw = (env[FEED_URL_ENV] ?? '').trim()
  if (!raw) return undefined
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return undefined
  }
  return u.protocol === 'https:' ? raw : undefined
}

/**
 * 异常 → 稳定机器码。广播给 renderer / 回给 IPC 调用方的 error 字段【只允许】
 * 这几个 kebab 码;原始异常全文只进 host.log(英文,给开发者看),绝不外流到界面。
 * 判定依据:electron-updater 的 HttpError 带 statusCode,消息文本带特征串;
 * Node 网络错误带 E* 码;超时由 check() 自己抛出含 "timed out" 的 Error。
 */
export function classifyUpdateError(e: unknown): string {
  const err = (e ?? {}) as { statusCode?: unknown; code?: unknown; message?: unknown }
  const status = Number(err.statusCode)
  const text = `${String(err.message ?? e ?? '')} ${String(err.code ?? '')}`.toLowerCase()
  if (status === 404 || text.includes('cannot find channel')) return 'update-channel-404'
  if (status === 403 || status === 429 || text.includes('rate limit')) return 'update-rate-limited'
  if (/etimedout|esockettimedout|timed out|timeout/.test(text)) return 'update-check-timeout'
  if (
    /enotfound|econnreset|econnrefused|econnaborted|enetunreach|ehostunreach|getaddrinfo|self[- ]signed|certificate|ssl|tls|network|socket hang up/.test(
      text
    )
  ) {
    return 'update-network'
  }
  return 'update-check-failed'
}

/** IPC `app:checkUpdate` 的返回形状(沿用接入前 SettingsDialog 已认的字段)。 */
export interface CheckResult {
  ok: boolean
  fresh?: boolean
  current?: string
  latest?: string
  url?: string
  name?: string
  notes?: string
  error?: string
}

/** 状态 → 手动检查结果。idle 且检查刚结束 = 已是最新(fresh)。 */
export function toCheckResult(
  state: AppUpdateState,
  current: string,
  releasesUrl: (v: string) => string
): CheckResult {
  if (state.phase === 'error') return { ok: false, error: state.error ?? 'update-check-failed' }
  if (state.phase === 'idle') {
    return { ok: true, fresh: true, current, latest: current, url: releasesUrl(current) }
  }
  const latest = state.latest ?? ''
  return { ok: true, fresh: false, current, latest, url: state.url ?? releasesUrl(latest) }
}

/** electron-updater 的 autoUpdater 单例里我们用到的部分(测试注入假货用)。 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  setFeedURL(config: { provider: 'generic'; url: string }): void
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
  on(event: string, cb: (arg?: unknown) => void): void
}

/** 动态 import 模块的原始形状(CJS 包在不同打包/运行时下形状不一)。 */
export type AutoUpdaterModule = unknown

/** 默认模块加载器:保持动态 import(不在顶层引 electron-updater)。 */
const importAutoUpdaterModule = (): Promise<AutoUpdaterModule> => import('electron-updater')

/**
 * CJS interop 归一化 —— 这是个真踩过的坑:electron-updater 是 CJS 包,打包后的
 * 主进程里 `await import('electron-updater')` 拿到的是 CJS 命名空间对象,
 * `autoUpdater` 可能只挂在 `.default` 上而不在顶层,直接 `.autoUpdater` 得到
 * undefined,下一行就炸(`Cannot read properties of undefined`)。
 * 两种形状都认;都拿不到就抛出可读英文错误,绝不带着 undefined 继续跑。
 */
export function resolveAutoUpdater(mod: AutoUpdaterModule): AutoUpdaterLike {
  const m = mod as { autoUpdater?: AutoUpdaterLike; default?: { autoUpdater?: AutoUpdaterLike } } | null
  const au = m?.autoUpdater ?? m?.default?.autoUpdater
  if (!au || typeof au.setFeedURL !== 'function' || typeof au.checkForUpdates !== 'function') {
    throw new Error(
      'electron-updater loaded but autoUpdater is missing on it ' +
        '(expected it as a named export or on .default); refusing to continue.'
    )
  }
  return au
}

export interface UpdaterHost {
  isPackaged: boolean
  platform: NodeJS.Platform
  currentVersion: string
  env: Record<string, string | undefined>
  /** 某版本的 GitHub 发布页(tag URL),给“前往下载”用。 */
  releasesUrl: (version: string) => string
  /** 「启动时自动检查更新」设置(默认开)。 */
  autoCheckEnabled: () => Promise<boolean>
  broadcast: (state: AppUpdateState) => void
  log: (msg: string) => void
  /** 检查更新的硬超时(ms,缺省 UPDATE_CHECK_TIMEOUT_MS=20s)。 */
  checkTimeoutMs?: number
  /** 测试注入定时器(假时钟可手动触发超时);缺省用全局 setTimeout/clearTimeout。 */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown
  clearTimeoutFn?: (timer: unknown) => void
  /** 测试注入已构造好的实例;生产走 loadAutoUpdaterModule(缺省=动态 import)。 */
  loadAutoUpdater?: () => Promise<AutoUpdaterLike>
  /**
   * 测试注入“模块形状”(如只有 .default 导出的 CJS 形状),会先过
   * resolveAutoUpdater 归一化 —— 真实打包形态的坑就出在这一步。
   */
  loadAutoUpdaterModule?: () => Promise<AutoUpdaterModule>
}

export interface UpdaterApi {
  state(): AppUpdateState
  /** 启动时调用:打 feed 覆盖日志、按设置做静默自动检查。永不抛出。 */
  start(): Promise<void>
  /** 手动「检查更新」。未打包返回稳定机器码 update-dev-mode。 */
  check(): Promise<CheckResult>
}

export function createUpdater(host: UpdaterHost): UpdaterApi {
  let current: AppUpdateState = { phase: 'idle' }
  let checking: Promise<CheckResult> | null = null
  let configured: Promise<AutoUpdaterLike> | null = null

  const emit = (ev: UpdateEvent): void => {
    const next = nextUpdateState(current, ev)
    if (next === current) return
    current = next
    host.broadcast(next)
  }

  const configuredOnce = (): Promise<AutoUpdaterLike> => {
    if (!configured) {
      configured = (async () => {
        const au = host.loadAutoUpdater
          ? await host.loadAutoUpdater()
          : resolveAutoUpdater(
              await (host.loadAutoUpdaterModule ?? importAutoUpdaterModule)()
            )
        const raw = (host.env[FEED_URL_ENV] ?? '').trim()
        const feed = feedOverrideFromEnv(host.env, host.isPackaged)
        if (feed) {
          // 醒目日志:有人把 feed 指向了别处(只可能发生在未打包构建)。覆盖只改地址;
          // sha512 校验照旧,且本代码不提供任何关闭校验的途径。默认源是 GitHub Releases WyattCode/x-ssh。
          // (开发者日志走英文;用户可见文案一律是 i18n key,由 renderer 出三语。)
          host.log(
            `[updater] !! ${FEED_URL_ENV} ACTIVE (unpackaged build only): update feed pointed at ${feed} ` +
              `(default is GitHub Releases WyattCode/x-ssh). Artifact sha512 is still ` +
              `verified against the manifest; this override cannot disable any check.`
          )
          au.setFeedURL({ provider: 'generic', url: feed })
        } else if (raw && host.isPackaged) {
          // 打包形态忽略这个覆盖:见 feedOverrideFromEnv 的注释(清单无签名,env 可达
          // = 任意代码执行面)。出于安全,feed 覆盖只在未打包构建中生效。
          host.log(
            `[updater] !! ${FEED_URL_ENV} is set, but IGNORED in packaged builds: for security, ` +
              `the feed override only takes effect in unpackaged builds (update manifests are not ` +
              `signed in electron-builder 26, so honoring it in shipped apps would let anyone who ` +
              `controls the environment redirect updates to arbitrary code). Using the default ` +
              `GitHub Releases feed.`
          )
        } else if (raw) {
          host.log(
            `[updater] !! ${FEED_URL_ENV} is set but not a valid https URL; ignored, using the default GitHub Releases feed.`
          )
        }
        const auto = allowsAutoDownload(host.platform, host.isPackaged)
        // Windows:自动下载 + 退出时安装;mac:恒 false,只走到 available 提示为止。
        au.autoDownload = auto
        au.autoInstallOnAppQuit = auto
        au.on('checking-for-update', () => emit({ type: 'check' }))
        au.on('update-available', (arg) => {
          const info = (arg ?? {}) as { version?: string }
          const version = info.version ?? ''
          emit({ type: 'available', version, url: version ? host.releasesUrl(version) : undefined })
        })
        au.on('update-not-available', () =>
          // 带上当前版本:idle+fresh 态要靠 latest 显示「已是最新版本 X」(第 3 条)。
          emit({ type: 'not-available', latest: host.currentVersion })
        )
        au.on('download-progress', (arg) => {
          const p = (arg ?? {}) as { percent?: number }
          emit({ type: 'progress', percent: Number(p.percent) || 0 })
        })
        au.on('update-downloaded', (arg) => {
          const info = (arg ?? {}) as { version?: string }
          const version = info.version ?? ''
          emit({ type: 'downloaded', version, url: version ? host.releasesUrl(version) : undefined })
        })
        au.on('error', (arg) => {
          // 原文全文只进开发者日志;广播只带稳定机器码(分类见 classifyUpdateError)。
          const code = classifyUpdateError(arg)
          host.log(
            `[updater] update error (${code}): ${String((arg as { message?: string })?.message ?? arg)}`
          )
          emit({ type: 'error', message: code })
        })
        return au
      })().catch((e) => {
        // 配置失败(含 resolveAutoUpdater 的形状断言)不许永久毒化:
        // 清掉缓存,下一次 check 可以重试。
        configured = null
        throw e
      })
    }
    return configured
  }

  const api: UpdaterApi = {
    state: () => current,
    async start(): Promise<void> {
      // 覆盖日志即使自动检查关着也要出现(环境被动过就该看得见)。
      const raw = (host.env[FEED_URL_ENV] ?? '').trim()
      if (raw && !host.isPackaged) {
        host.log(`[updater] !! ${FEED_URL_ENV} is set, but the update path never runs in dev mode; ignored.`)
      }
      if (!host.isPackaged) return
      try {
        await configuredOnce()
        if (await host.autoCheckEnabled()) await api.check()
      } catch (e) {
        host.log(`[updater] automatic update check could not start: ${String((e as Error)?.message ?? e)}`)
      }
    },
    async check(): Promise<CheckResult> {
      // 未打包没有 app-update.yml / 更新产物,electron-updater 只能报 ENOENT;
      // 返回稳定机器码,由 renderer 出三语文案。
      if (!host.isPackaged) return { ok: false, error: 'update-dev-mode' }
      if (checking) return checking
      const run = (async (): Promise<CheckResult> => {
        // 硬超时。electron-updater 的请求不保证会失败(挂死的 TCP 连接能永远不 settle)。
        // 超时能做的只有一件事,也只做这一件:解除界面阻塞 —— 释放我们自己的 checking
        // 闭包,按钮不再卡「检查中」。它【不能】取消底层请求:electron-updater 内部对
        // checkForUpdates 去重(node_modules/electron-updater/out/AppUpdater.js:254-275,
        // checkForUpdatesPromise 未 settle 前再调只返回同一个 promise,日志打
        // "Checking for update (already in progress)"),所以挂死的请求没 settle 时再点
        // 「检查」会再吃一次完整的超时。electron-updater 没有取消进行中检查的公开 API,
        // 真重试 = 重启进程。
        const timeoutMs = host.checkTimeoutMs ?? UPDATE_CHECK_TIMEOUT_MS
        let timer: unknown = null
        try {
          const au = await configuredOnce()
          emit({ type: 'check' })
          const pending = au.checkForUpdates()
          // 超时胜出后,真实请求若稍后才拒绝,不该变成 unhandled rejection。
          pending.catch(() => undefined)
          await Promise.race([
            pending,
            new Promise<never>((_resolve, reject) => {
              const onTimeout = (): void =>
                reject(new Error(`update check timed out after ${timeoutMs} ms`))
              timer = host.setTimeoutFn
                ? host.setTimeoutFn(onTimeout, timeoutMs)
                : setTimeout(onTimeout, timeoutMs)
            })
          ])
          // 事件先于这个 resolve 进入状态机,读 current 即是最终态。
          return toCheckResult(current, host.currentVersion, host.releasesUrl)
        } catch (e) {
          // 原始异常全文只进开发者日志;界面/返回值只带稳定机器码。
          const code = classifyUpdateError(e)
          host.log(`[updater] update check failed (${code}): ${String((e as Error)?.message ?? e)}`)
          emit({ type: 'error', message: code })
          return { ok: false, error: code }
        } finally {
          if (timer !== null) {
            if (host.clearTimeoutFn) host.clearTimeoutFn(timer)
            else clearTimeout(timer as ReturnType<typeof setTimeout>)
          }
          checking = null
        }
      })()
      checking = run
      return run
    }
  }
  return api
}
