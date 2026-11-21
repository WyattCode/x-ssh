/**
 * What main actually threw, without Electron's wrapper.
 *
 * A rejected `ipcRenderer.invoke` arrives as
 * "Error invoking remote method 'hosts:save': Error: EPERM: operation not permitted, …".
 * The wrapper (channel name, error class) says nothing to the user; shown as-is it pushed
 * the real reason to the end of the line.
 */
export function ipcReason(e: unknown): string {
  const msg = typeof e === 'string' ? e : ((e as { message?: unknown } | null)?.message ?? '')
  return String(msg).replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '')
}
