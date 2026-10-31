import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { ConnectParams, ConnectResult } from '../shared/types'
import type { SettingsStore } from './settings'
import { UserVerify } from './userVerify'
import { connectNeedsPrivateKey } from './keyAuth'
import type { UiLang } from '../shared/lang'

export { connectNeedsPrivateKey }

/**
 * The reason line Windows Hello draws under the prompt. The OS renders it, so
 * it cannot come from the renderer's dictionary — it needs its own table
 * here, driven by the same `lang` setting the tray menu uses.
 *
 * `{n}` / `{total}` are filled only for the batch paths (publishing or
 * revoking a key across several hosts), where the user otherwise sees an
 * identical prompt N times in a row with no hint that anything is progressing.
 */
/* i18n-allow-start: Windows Hello 的提示行由 OS 绘制、不经渲染层，所以主进程自带这份三语表（与托盘菜单同属一类） */
const HELLO_TEXT: Record<'keyUse' | 'keyUseNth' | 'test', Record<UiLang, string>> = {
  keyUse: {
    zh: 'X-SSH 私钥',
    'zh-TW': 'X-SSH 私鑰',
    en: 'X-SSH private key'
  },
  keyUseNth: {
    zh: 'X-SSH 私钥（{n}/{total}）',
    'zh-TW': 'X-SSH 私鑰（{n}/{total}）',
    en: 'X-SSH private key ({n}/{total})'
  },
  test: {
    zh: 'X-SSH 测试',
    'zh-TW': 'X-SSH 測試',
    en: 'X-SSH test'
  }
}
/* i18n-allow-end */

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
  opts: {
    /** Current UI language resolver, shared with the tray menu. */
    lang: () => Promise<UiLang>
    /** 1-based position in a batch operation; both omitted for a single connect. */
    nth?: number
    total?: number
  }
): Promise<GateKeyResult> {
  if (!connectNeedsPrivateKey(params)) return { proceed: true }
  if (!(await uv.enabled())) return { proceed: true }
  focusMainWindow()
  const reason = await helloText(opts.lang, opts.nth, opts.total)
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

/**
 * Reason text for one Hello prompt. Pure so it can be unit-tested without
 * launching PowerShell; falls back to English when a language is missing.
 */
export function helloTextFor(
  lang: UiLang,
  nth?: number,
  total?: number
): string {
  // Only show the counter for a real batch. A stray nth/total (e.g. total 1,
  // or nth out of range after a host list shrank) must not print "(3/2)".
  const isBatch =
    typeof nth === 'number' && typeof total === 'number' && total > 1 && nth >= 1 && nth <= total
  const row = isBatch ? HELLO_TEXT.keyUseNth : HELLO_TEXT.keyUse
  return (row[lang] ?? row.en).replace('{n}', String(nth)).replace('{total}', String(total))
}

async function helloText(lang: () => Promise<UiLang>, nth?: number, total?: number): Promise<string> {
  let l: UiLang = 'en'
  try {
    l = await lang()
  } catch {
    /* a missing/broken setting must never block the prompt: English is fine */
  }
  return helloTextFor(l, nth, total)
}

export function registerUserVerifyIpc(opts: {
  settings: SettingsStore
  lang: () => Promise<UiLang>
}): UserVerify {
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
    let l: UiLang = 'en'
    try {
      l = await opts.lang()
    } catch {
      /* fall through to English */
    }
    const r = await uv.verify(HELLO_TEXT.test[l] ?? HELLO_TEXT.test.en)
    if (r.outcome === 'verified') uv.markUnlocked()
    return r
  })
  return uv
}
