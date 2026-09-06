/**
 * Platform helpers. The app-level modifier differs by OS: ⌘ on macOS (leaving
 * every Ctrl combo free for the shell), Ctrl on Windows/Linux.
 */
export const isMac = window.api.platform === 'darwin'

/** True when the platform's app-level modifier is held: ⌘ on macOS, Ctrl elsewhere. */
export function appMod(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}
