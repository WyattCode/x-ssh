import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { ConnectParams, ConnectResult } from '../shared/types'
import type { SettingsStore } from './settings'
import { UserVerify } from './userVerify'
import { connectNeedsPrivateKey } from './keyAuth'

export { connectNeedsPrivateKey }

export type GateKeyResult =
  | { proceed: true; warned?: 'userVerifyUnavailable' }
  | { proceed: false; result: ConnectResult }

/** Bring the app window to the front so the OS Hello prompt is visible. */
function focusMainWindow(): void {
  try {
    const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (w && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
      w.moveTop()
    }
  } catch {
    /* ignore */
  }
}

export async function gateKeyConnect(
  uv: UserVerify,
  params: ConnectParams,
  reason = 'X-SSH 私钥'
): Promise<GateKeyResult> {
  if (!connectNeedsPrivateKey(params)) return { proceed: true }
  if (!(await uv.enabled())) return { proceed: true }
  focusMainWindow()
  const r = await uv.ensureForKeyUse(reason)
  if (!r.ok) {
    return { proceed: false, result: { ok: false, code: r.code, error: r.message } }
  }
  if (r.warned === 'userVerifyUnavailable') {
    return { proceed: true, warned: 'userVerifyUnavailable' }
  }
  return { proceed: true }
}

/** True when quiet/background key use should be skipped (gate on, session not unlocked). */
export async function userVerifyBlocksQuiet(uv: UserVerify): Promise<boolean> {
  if (!(await uv.enabled())) return false
  return !uv.isSessionUnlocked()
}

export function registerUserVerifyIpc(opts: { settings: SettingsStore }): UserVerify {
  const uv = new UserVerify({ settings: opts.settings })
  const status = async () => {
    const supported = uv.supported
    const enabled = await uv.enabled()
    const available = supported ? await uv.availability() : 'unsupported'
    return {
      supported,
      enabled,
      available,
      sessionUnlocked: uv.isSessionUnlocked()
    }
  }
  ipcMain.handle(IPC.userVerifyStatus, () => status())
  ipcMain.handle(IPC.userVerifySetEnabled, async (_e, on: unknown) => {
    await uv.setEnabled(on === true)
    return status()
  })
  ipcMain.handle(IPC.userVerifyTest, async () => {
    if (!uv.supported) return { outcome: 'unsupported' as const }
    focusMainWindow()
    const r = await uv.verify('X-SSH 测试')
    if (r.outcome === 'verified') uv.markUnlocked()
    return r
  })
  return uv
}
