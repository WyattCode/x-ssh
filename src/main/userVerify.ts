import { execFile } from 'node:child_process'

/** 系统验证结果 */
export type VerifyOutcome = 'verified' | 'canceled' | 'unavailable' | 'failed' | 'unsupported'

export interface VerifyResult {
  outcome: VerifyOutcome
  detail?: string
}

/** 执行 PowerShell 脚本的抽象（便于在 Linux 上测试） */
export type RunPowerShell = (
  script: string,
  env: Record<string, string>,
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string }>

/** 设置项 key：Windows Hello 门禁开关 */
export const WIN_HELLO_KEY = 'winHelloKeyGate'
/** 验证通过后的会话有效期 */
export const SESSION_TTL_MS = 5 * 60_000

/** 可用性探测结果缓存时长 */
const AVAILABILITY_TTL_MS = 60_000
/** 验证脚本超时（略大于 60s，由子进程超时兜底） */
const VERIFY_TIMEOUT_MS = 65_000
/** 可用性探测超时 */
const AVAILABILITY_TIMEOUT_MS = 15_000

const RESULT_TAG = 'RESULT:'
const AVAIL_TAG = 'AVAIL:'

/**
 * 生成 Windows Hello 验证脚本。
 * 注意：reason 只通过环境变量 XSSH_VERIFY_REASON 传入，绝不拼接进脚本。
 */
export function buildVerifyScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  [void][Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]',
    '  $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:XSSH_VERIFY_REASON)',
    "  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    '  $task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($op))',
    '  [void]$task.Wait(-1)',
    '  Write-Output ("RESULT:" + $task.Result.ToString())',
    '} catch {',
    '  Write-Output ("RESULT:Error:" + $_.Exception.Message)',
    '}',
  ].join('\n')
}

/** 生成 Windows Hello 可用性探测脚本 */
export function buildAvailabilityScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  [void][Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]',
    '  $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()',
    "  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    '  $task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @($op))',
    '  [void]$task.Wait(-1)',
    '  Write-Output ("AVAIL:" + $task.Result.ToString())',
    '} catch {',
    '  Write-Output ("AVAIL:Error:" + $_.Exception.Message)',
    '}',
  ].join('\n')
}

/** 在 stdout 中查找带前缀的行，返回前缀之后的内容（已 trim） */
function findTaggedLine(stdout: string, tag: string): string | null {
  if (!stdout) return null
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith(tag)) return line.slice(tag.length).trim()
  }
  return null
}

/** UserConsentVerificationResult 枚举名 → 结果 */
export function mapVerificationResult(name: string): VerifyOutcome {
  const n = (name ?? '').trim()
  switch (n) {
    case 'Verified':
      return 'verified'
    case 'Canceled':
      return 'canceled'
    case 'DeviceNotPresent':
    case 'NotConfiguredForUser':
    case 'DisabledByPolicy':
      return 'unavailable'
    case 'DeviceBusy':
    case 'RetriesExhausted':
      return 'failed'
    default:
      // Error* / 空 / 无法识别的输出一律视为失败
      return 'failed'
  }
}

/** 解析验证脚本输出 */
export function parseVerifyOutput(stdout: string): VerifyResult {
  const line = findTaggedLine(stdout, RESULT_TAG)
  if (line === null) return { outcome: 'failed', detail: 'no RESULT line' }
  if (line.startsWith('Error:')) {
    const detail = line.slice('Error:'.length).trim()
    return detail ? { outcome: 'failed', detail } : { outcome: 'failed' }
  }
  return { outcome: mapVerificationResult(line) }
}

/** 解析可用性脚本输出 */
export function parseAvailabilityOutput(stdout: string): 'available' | 'unavailable' | 'failed' {
  const line = findTaggedLine(stdout, AVAIL_TAG)
  if (line === null) return 'failed'
  if (line.startsWith('Error:')) return 'failed'
  if (line === 'Available') return 'available'
  return 'unavailable'
}

/**
 * 默认实现：调用 Windows PowerShell 5.1（不是 pwsh）。
 * 脚本以 UTF-16LE + base64 通过 -EncodedCommand 传入，避免引号/转义问题。
 */
export const defaultRunPowerShell: RunPowerShell = (script, env, timeoutMs) =>
  new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encoded,
    ]
    execFile(
      'powershell.exe',
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ...env },
      },
      (err, stdout, stderr) => {
        const rawCode = (err as NodeJS.ErrnoException | null)?.code
        // 非数字 code 表示启动失败 / 超时 / 被 kill，直接抛错
        if (err && typeof rawCode !== 'number') {
          reject(err)
          return
        }
        resolve({
          code: typeof rawCode === 'number' ? rawCode : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        })
      },
    )
  })

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export interface UserVerifyOptions {
  settings: {
    get: <T>(k: string) => Promise<T | undefined>
    set: (k: string, v: unknown) => Promise<void>
  }
  platform?: NodeJS.Platform
  runPowerShell?: RunPowerShell
  now?: () => number
}

export class UserVerify {
  private readonly settings: UserVerifyOptions['settings']
  private readonly platform: NodeJS.Platform
  private readonly runPowerShell: RunPowerShell
  private readonly now: () => number

  private availabilityCache: { value: 'available' | 'unavailable'; at: number } | null = null
  private unlockedAt: number | null = null
  private inflight: Promise<VerifyResult> | null = null

  constructor(o: UserVerifyOptions) {
    this.settings = o.settings
    this.platform = o.platform ?? process.platform
    this.runPowerShell = o.runPowerShell ?? defaultRunPowerShell
    this.now = o.now ?? Date.now
  }

  /** 仅 Windows 支持 */
  get supported(): boolean {
    return this.platform === 'win32'
  }

  /** 探测 Windows Hello 可用性（缓存 ~60s） */
  async availability(): Promise<'available' | 'unavailable' | 'unsupported'> {
    if (!this.supported) return 'unsupported'

    const cached = this.availabilityCache
    if (cached && this.now() - cached.at < AVAILABILITY_TTL_MS) return cached.value

    let value: 'available' | 'unavailable' = 'unavailable'
    try {
      const r = await this.runPowerShell(buildAvailabilityScript(), {}, AVAILABILITY_TIMEOUT_MS)
      // parseAvailability 的 'failed' 在这里统一降级为 unavailable
      value = parseAvailabilityOutput(r.stdout) === 'available' ? 'available' : 'unavailable'
    } catch {
      value = 'unavailable'
    }
    this.availabilityCache = { value, at: this.now() }
    return value
  }

  /**
   * 触发一次系统验证。
   * 互斥：并发调用复用同一个进行中的 Promise，避免弹出多个 Hello 对话框。
   */
  async verify(reason: string): Promise<VerifyResult> {
    if (!this.supported) return { outcome: 'unsupported' }
    if (this.inflight) return this.inflight

    const p = this.doVerify(reason).finally(() => {
      this.inflight = null
    })
    this.inflight = p
    return p
  }

  private async doVerify(reason: string): Promise<VerifyResult> {
    try {
      const r = await this.runPowerShell(
        buildVerifyScript(),
        { XSSH_VERIFY_REASON: reason },
        VERIFY_TIMEOUT_MS,
      )
      return parseVerifyOutput(r.stdout)
    } catch (e) {
      return { outcome: 'failed', detail: errMessage(e) }
    }
  }

  /** 会话是否仍处于已解锁状态 */
  isSessionUnlocked(): boolean {
    if (this.unlockedAt === null) return false
    if (this.now() - this.unlockedAt >= SESSION_TTL_MS) {
      this.unlockedAt = null
      return false
    }
    return true
  }

  markUnlocked(): void {
    this.unlockedAt = this.now()
  }

  clearSession(): void {
    this.unlockedAt = null
  }

  /** 门禁是否开启（非 Windows 恒为 false） */
  async enabled(): Promise<boolean> {
    if (!this.supported) return false
    const v = await this.settings.get<boolean>(WIN_HELLO_KEY)
    return v === true
  }

  async setEnabled(on: boolean): Promise<void> {
    await this.settings.set(WIN_HELLO_KEY, on === true)
    if (!on) this.clearSession()
  }

  /**
   * 使用密钥前的门禁检查。
   * 门禁关闭 / 会话已解锁 / 平台不支持 → 直接放行。
   * 系统验证不可用 → 放行但带 warning（fail-open）。
   */
  async ensureForKeyUse(reason: string): Promise<
    | { ok: true; warned?: 'userVerifyUnavailable' }
    | { ok: false; code: 'userVerifyCanceled' | 'userVerifyFailed'; message: string }
  > {
    if (!this.supported) return { ok: true }
    if (!(await this.enabled())) return { ok: true }
    if (this.isSessionUnlocked()) return { ok: true }

    const avail = await this.availability()
    if (avail === 'unsupported') return { ok: true }
    if (avail === 'unavailable') return { ok: true, warned: 'userVerifyUnavailable' }

    const res = await this.verify(reason)
    switch (res.outcome) {
      case 'verified':
        this.markUnlocked()
        return { ok: true }
      case 'canceled':
        // i18n-allow-next: message 只作主进程侧诊断，界面按 code 出文案（hello.canceled）
        return { ok: false, code: 'userVerifyCanceled', message: '系统验证已取消' }
      case 'unavailable':
        // 验证过程中设备消失/被策略禁用 → fail-open
        return { ok: true, warned: 'userVerifyUnavailable' }
      case 'unsupported':
        return { ok: true }
      default:
        // i18n-allow-next: message 只作主进程侧诊断，界面按 code 出文案（hello.failed）
        return { ok: false, code: 'userVerifyFailed', message: '系统验证失败' }
    }
  }
}
