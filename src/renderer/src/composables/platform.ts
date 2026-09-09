/**
 * Platform helpers. The app-level modifier differs by OS: ⌘ on macOS (leaving
 * every Ctrl combo free for the shell), Ctrl on Windows/Linux.
 */
// Guarded so this module is safe to import from code that unit tests exercise
// under Node, where there is no window at all. Node's own navigator.platform
// reports the *host* ("MacIntel" on a Mac), which is why sniffing it made
// Ctrl-based chord tests fail on macOS but pass on Windows.
export const isMac =
  typeof window !== 'undefined' && window.api?.platform === 'darwin'

/** True when the platform's app-level modifier is held: ⌘ on macOS, Ctrl elsewhere. */
export function appMod(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}
