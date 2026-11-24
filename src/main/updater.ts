/**
 * electron-updater 封装:更新状态机 + 一次性接线。
 *
 * 更新源 = 本仓库的 GitHub Releases(WyattCode/x-ssh,见 package.json build.publish),
 * 不自架服务器。feed 地址只允许通过环境变量 XSSH_UPDATE_FEED_URL 覆盖
 * (feedOverrideFromEnv),生效时打一条醒目日志;覆盖只改「从哪拉清单」,
 * 产物 sha512 始终按清单校验 —— 这里没有任何“跳过校验”的开关。
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
import { compareVersions } from '../shared/launchTarget'
import type { AppUpdateState } from '../shared/ipc'

/** 唯一允许的 feed 覆盖入口(仅 https)。除它以外没有任何校验降级开关。 */
export const FEED_URL_ENV = 'XSSH_UPDATE_FEED_URL'

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'available'; version: string; url?: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string; url?: string }
  | { type: 'error'; message: string }
  | { type: 'reset' }

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
    case 'not-available':
      return s.phase === 'checking' ? { phase: 'idle' } : s
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
    case 'reset':
      return { phase: 'idle' }
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

/** latest 是否比 current 新(严格大于;compareVersions 来自 shared,已在用)。 */
export function hasNewerVersion(current: string, latest: string): boolean {
  return compareVersions(latest, current) > 0
}

/**
 * feed 覆盖判定:仅接受 XSSH_UPDATE_FEED_URL 给出的合法 https 地址。
 * 未设 / 空 / 非 https(含 file://、http://)一律回退默认 GitHub Releases。
 * 这个覆盖永远不可能关闭 sha512 校验 —— 代码里根本不存在那样的开关。
 */
export function feedOverrideFromEnv(env: Record<string, string | undefined>): string | undefined {
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

/** 载入 electron-updater 的 autoUpdater 单例(仅打包形态;index.ts 的退出安装也走这里)。 */
export async function getAutoUpdater(): Promise<AutoUpdaterLike> {
  return resolveAutoUpdater(await importAutoUpdaterModule())
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
        const feed = feedOverrideFromEnv(host.env)
        if (feed) {
          // 醒目日志:有人把 feed 指向了别处。覆盖只改地址;sha512 校验照旧,
          // 且本代码不提供任何关闭校验的途径。默认源是 GitHub Releases WyattCode/x-ssh。
          // (开发者日志走英文;用户可见文案一律是 i18n key,由 renderer 出三语。)
          host.log(
            `[updater] !! ${FEED_URL_ENV} ACTIVE: update feed pointed at ${feed} ` +
              `(default is GitHub Releases WyattCode/x-ssh). Artifact sha512 is still ` +
              `verified against the manifest; this override cannot disable any check.`
          )
          au.setFeedURL({ provider: 'generic', url: feed })
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
        au.on('update-not-available', () => emit({ type: 'not-available' }))
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
          const e = arg as { message?: string } | undefined
          emit({ type: 'error', message: String(e?.message ?? e ?? 'update-check-failed') })
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
        try {
          const au = await configuredOnce()
          emit({ type: 'check' })
          // 事件先于这个 resolve 进入状态机,读 current 即是最终态。
          await au.checkForUpdates()
          return toCheckResult(current, host.currentVersion, host.releasesUrl)
        } catch (e) {
          const message = String((e as Error)?.message ?? e)
          emit({ type: 'error', message })
          return { ok: false, error: message }
        } finally {
          checking = null
        }
      })()
      checking = run
      return run
    }
  }
  return api
}
