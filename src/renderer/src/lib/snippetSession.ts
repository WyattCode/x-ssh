/**
 * Whether a snippet may still be typed into the session it was aimed at.
 *
 * `sendSnippet` captures the active pane's session id, then awaits a confirm
 * dialog and/or the variable prompt. By the time those resolve the session may
 * have dropped, its pane closed, or the user switched to another tab — typing
 * into the captured id would then hit a dead (or, worse, reused) session. This
 * is the pure check that decides whether the id is still live.
 */
export function liveSnippetSessionId(
  sid: string | undefined,
  pane: { status: string; sshSessionId?: string } | undefined | null
): string | null {
  if (!sid) return null
  if (!pane) return null
  if (pane.status !== 'connected') return null
  if (pane.sshSessionId !== sid) return null
  return sid
}
