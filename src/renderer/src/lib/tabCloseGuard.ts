/** True when confirmClose is on and any tab has a connected pane. */
export function closeAllNeedsConfirm(
  confirmClose: boolean,
  tabs: ReadonlyArray<{ panes: ReadonlyArray<{ status: string }> }>
): boolean {
  if (!confirmClose) return false
  return tabs.some((tab) => tab.panes.some((p) => p.status === 'connected'))
}
