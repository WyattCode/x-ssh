/** True when any pane in any tab is currently connected over SSH. */
export function hasLiveConnectedPane(
  tabs: ReadonlyArray<{ panes: ReadonlyArray<{ status: string }> }>
): boolean {
  return tabs.some((tab) => tab.panes.some((pane) => pane.status === 'connected'))
}

/**
 * Whether "Close others" must confirm first.
 * Only when the user enabled confirmClose AND at least one tab other than
 * `keepId` still has a connected pane. The kept tab being live does not count.
 */
export function closeOthersNeedsConfirm(
  confirmClose: boolean,
  tabs: ReadonlyArray<{ id: string; panes: ReadonlyArray<{ status: string }> }>,
  keepId: string
): boolean {
  if (!confirmClose) return false
  return tabs.some(
    (tab) => tab.id !== keepId && tab.panes.some((pane) => pane.status === 'connected')
  )
}
