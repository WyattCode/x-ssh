/**
 * The IPC sender check, as a pure function.
 *
 * Every `ipcMain` handler in index.ts runs behind this. It lives here so it can
 * be tested without booting Electron: the real event carries a `WebFrameMain`,
 * and Electron hands out one object per frame, so identity comparison is the
 * correct (and only safe) test — comparing URLs would accept any frame that
 * navigated to the same address, and a subframe inherits its parent's origin.
 *
 * `fullyTrusted` is deliberately narrow: only the window's own main frame may
 * call main. A `<webview>` or an injected iframe gets the same preload API
 * otherwise, which with `sandbox: false` means filesystem and credential
 * access.
 */
export function isTrustedFrame(
  sender: object | null | undefined,
  mainFrame: object | null | undefined
): boolean {
  if (!sender || !mainFrame) return false
  return sender === mainFrame
}
