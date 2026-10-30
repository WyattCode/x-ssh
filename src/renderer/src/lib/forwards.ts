/** Live (running) forward rules for the active pane.
 *  Saved host rules are opened by main on connect and never land in
 *  pane.params.portForwards, so counting that array undercounts. */
export function liveForwardCount(
  groups: { id: string; host?: { id: string }; rows: { running: boolean }[] }[],
  pane: { id: string; params: { hostId?: string } } | undefined
): number {
  if (!pane) return 0
  const hostId = pane.params.hostId
  const g = hostId
    ? groups.find((x) => x.host?.id === hostId)
    : groups.find((x) => x.id === pane.id)
  return g ? g.rows.filter((r) => r.running).length : 0
}
