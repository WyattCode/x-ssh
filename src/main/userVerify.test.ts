import { describe, expect, it } from 'vitest'
import {
  SESSION_TTL_MS,
  UserVerify,
  WIN_HELLO_KEY,
  buildAvailabilityScript,
  buildVerifyScript,
  mapVerificationResult,
  parseAvailabilityOutput,
  parseVerifyOutput,
  type RunPowerShell,
} from './userVerify'

interface SettingsStore {
  get: <T>(k: string) => Promise<T | undefined>
  set: (k: string, v: unknown) => Promise<void>
}

function makeSettings(initial: Record<string, unknown> = {}): SettingsStore & {
  store: Map<string, unknown>
} {
  const store = new Map<string, unknown>(Object.entries(initial))
  return {
    store,
    get: async <T>(k: string) => store.get(k) as T | undefined,
    set: async (k: string, v: unknown) => {
      store.set(k, v)
    },
  }
}

interface RunnerCall {
  script: string
  env: Record<string, string>
  timeoutMs: number
}

function makeRunner(opts: { verify?: string; avail?: string } = {}) {
  const calls: RunnerCall[] = []
  const run: RunPowerShell = async (script, env, timeoutMs) => {
    calls.push({ script, env, timeoutMs })
    const isAvail = script.includes('CheckAvailabilityAsync')
    const stdout = isAvail ? (opts.avail ?? 'AVAIL:Available') : (opts.verify ?? 'RESULT:Verified')
    return { code: 0, stdout: `${stdout}\r\n`, stderr: '' }
  }
  return { run, calls }
}

describe('UserVerify 平台支持', () => {
  it('linux 上 supported=false，enabled=false，ensureForKeyUse 直接放行且不调用 PowerShell', async () => {
    const { run, calls } = makeRunner()
    const uv = new UserVerify({
      settings: makeSettings({ [WIN_HELLO_KEY]: true }),
      platform: 'linux',
      runPowerShell: run,
    })

    expect(uv.supported).toBe(false)
    expect(await uv.enabled()).toBe(false)

    const r = await uv.ensureForKeyUse('测试原因')
    expect(r).toEqual({ ok: true })
    expect(calls).toHaveLength(0)
  })
})

describe('脚本生成', () => {
  it('验证脚本包含 WinRT 类型、AsTask 反射与环境变量传参', () => {
    const s = buildVerifyScript()
    expect(s).toContain('Windows.Security.Credentials.UI.UserConsentVerifier')
    expect(s).toContain('RequestVerificationAsync')
    expect(s).toContain('System.WindowsRuntimeSystemExtensions')
    expect(s).toContain('$env:XSSH_VERIFY_REASON')
    expect(s).toContain('RESULT:')
    expect(s).toContain('RESULT:Error:')
  })

  it('可用性脚本包含 CheckAvailabilityAsync 与 AVAIL 前缀', () => {
    const s = buildAvailabilityScript()
    expect(s).toContain('CheckAvailabilityAsync')
    expect(s).toContain('AVAIL:')
    expect(s).toContain('AVAIL:Error:')
  })
})

describe('parseVerifyOutput', () => {
  it('映射各枚举值', () => {
    expect(parseVerifyOutput('RESULT:Verified\r\n').outcome).toBe('verified')
    expect(parseVerifyOutput('RESULT:Canceled').outcome).toBe('canceled')
    expect(parseVerifyOutput('RESULT:DeviceNotPresent').outcome).toBe('unavailable')
    expect(parseVerifyOutput('RESULT:RetriesExhausted').outcome).toBe('failed')
  })

  it('Error 行 → failed 并带 detail', () => {
    const r = parseVerifyOutput('RESULT:Error:boom')
    expect(r.outcome).toBe('failed')
    expect(r.detail).toBe('boom')
  })

  it('空输出 / 垃圾输出 → failed', () => {
    expect(parseVerifyOutput('').outcome).toBe('failed')
    expect(parseVerifyOutput('garbage').outcome).toBe('failed')
    expect(parseVerifyOutput('RESULT:').outcome).toBe('failed')
  })

  it('mapVerificationResult 直接调用', () => {
    expect(mapVerificationResult('Verified')).toBe('verified')
    expect(mapVerificationResult('DisabledByPolicy')).toBe('unavailable')
    expect(mapVerificationResult('DeviceBusy')).toBe('failed')
    expect(mapVerificationResult('ErrorUnknown')).toBe('failed')
    expect(mapVerificationResult('')).toBe('failed')
  })
})

describe('parseAvailabilityOutput', () => {
  it('Available / 其他枚举 / Error', () => {
    expect(parseAvailabilityOutput('AVAIL:Available')).toBe('available')
    expect(parseAvailabilityOutput('AVAIL:NotConfiguredForUser')).toBe('unavailable')
    expect(parseAvailabilityOutput('AVAIL:Error:boom')).toBe('failed')
    expect(parseAvailabilityOutput('')).toBe('failed')
  })
})

describe('会话 TTL', () => {
  it('markUnlocked 后超过 SESSION_TTL_MS 重新上锁', () => {
    let t = 1_000_000
    const { run } = makeRunner()
    const uv = new UserVerify({
      settings: makeSettings(),
      platform: 'win32',
      runPowerShell: run,
      now: () => t,
    })

    expect(uv.isSessionUnlocked()).toBe(false)
    uv.markUnlocked()
    expect(uv.isSessionUnlocked()).toBe(true)

    t += SESSION_TTL_MS - 1
    expect(uv.isSessionUnlocked()).toBe(true)

    t += 2
    expect(uv.isSessionUnlocked()).toBe(false)
  })

  it('setEnabled(false) 清空会话', async () => {
    const settings = makeSettings({ [WIN_HELLO_KEY]: true })
    const { run } = makeRunner()
    const uv = new UserVerify({ settings, platform: 'win32', runPowerShell: run })

    uv.markUnlocked()
    expect(uv.isSessionUnlocked()).toBe(true)

    await uv.setEnabled(false)
    expect(uv.isSessionUnlocked()).toBe(false)
    expect(settings.store.get(WIN_HELLO_KEY)).toBe(false)
    expect(await uv.enabled()).toBe(false)
  })
})

describe('ensureForKeyUse', () => {
  it('门禁开启且可用：Verified 解锁会话，第二次调用不再启动 PowerShell', async () => {
    const settings = makeSettings({ [WIN_HELLO_KEY]: true })
    const { run, calls } = makeRunner()
    const uv = new UserVerify({ settings, platform: 'win32', runPowerShell: run })

    const r1 = await uv.ensureForKeyUse('使用密钥')
    expect(r1).toEqual({ ok: true })
    expect(uv.isSessionUnlocked()).toBe(true)

    // reason 只通过环境变量传递
    const verifyCall = calls.find((c) => c.script.includes('RequestVerificationAsync'))
    expect(verifyCall).toBeTruthy()
    expect(verifyCall!.env.XSSH_VERIFY_REASON).toBe('使用密钥')
    expect(verifyCall!.script).not.toContain('使用密钥')

    const before = calls.length
    const r2 = await uv.ensureForKeyUse('使用密钥')
    expect(r2).toEqual({ ok: true })
    expect(calls.length).toBe(before)
  })

  it('Canceled → ok:false / userVerifyCanceled', async () => {
    const settings = makeSettings({ [WIN_HELLO_KEY]: true })
    const { run } = makeRunner({ verify: 'RESULT:Canceled' })
    const uv = new UserVerify({ settings, platform: 'win32', runPowerShell: run })

    const r = await uv.ensureForKeyUse('使用密钥')
    expect(r).toEqual({ ok: false, code: 'userVerifyCanceled', message: '系统验证已取消' })
    expect(uv.isSessionUnlocked()).toBe(false)
  })

  it('DeviceNotPresent → ok:true 且带 warned', async () => {
    const settings = makeSettings({ [WIN_HELLO_KEY]: true })
    const { run } = makeRunner({ verify: 'RESULT:DeviceNotPresent' })
    const uv = new UserVerify({ settings, platform: 'win32', runPowerShell: run })

    const r = await uv.ensureForKeyUse('使用密钥')
    expect(r).toEqual({ ok: true, warned: 'userVerifyUnavailable' })
    expect(uv.isSessionUnlocked()).toBe(false)
  })

  it('可用性探测不可用 → 直接放行并带 warned，不触发验证', async () => {
    const settings = makeSettings({ [WIN_HELLO_KEY]: true })
    const { run, calls } = makeRunner({ avail: 'AVAIL:NotConfiguredForUser' })
    const uv = new UserVerify({ settings, platform: 'win32', runPowerShell: run })

    const r = await uv.ensureForKeyUse('使用密钥')
    expect(r).toEqual({ ok: true, warned: 'userVerifyUnavailable' })
    expect(calls.some((c) => c.script.includes('RequestVerificationAsync'))).toBe(false)
  })

  it('门禁关闭 → 直接放行，不调用 PowerShell', async () => {
    const { run, calls } = makeRunner()
    const uv = new UserVerify({
      settings: makeSettings(),
      platform: 'win32',
      runPowerShell: run,
    })

    const r = await uv.ensureForKeyUse('使用密钥')
    expect(r).toEqual({ ok: true })
    expect(calls).toHaveLength(0)
  })
})

describe('verify 互斥', () => {
  it('并发 verify 只启动一次 PowerShell，两个调用共享结果', async () => {
    let started = 0
    let releaseRun!: (r: { code: number; stdout: string; stderr: string }) => void
    const gate = new Promise<{ code: number; stdout: string; stderr: string }>((res) => {
      releaseRun = res
    })
    const run: RunPowerShell = async () => {
      started += 1
      return gate
    }

    const uv = new UserVerify({
      settings: makeSettings(),
      platform: 'win32',
      runPowerShell: run,
    })

    const p1 = uv.verify('a')
    const p2 = uv.verify('b')
    releaseRun({ code: 0, stdout: 'RESULT:Verified', stderr: '' })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(started).toBe(1)
    expect(r1.outcome).toBe('verified')
    expect(r2.outcome).toBe('verified')
  })
})
