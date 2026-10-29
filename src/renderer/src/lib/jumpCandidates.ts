import type { Host } from '../../../shared/types'

/** Hosts that may be chosen as a one-hop ProxyJump for `selfId` (undefined = new host). */
export function jumpCandidates(hosts: readonly Host[], selfId: string | undefined): Host[] {
  return hosts.filter((h) => h.id !== selfId && !h.jumpHostId)
}

/** Saved hosts that currently tunnel through `selfId`. */
export function jumpUsedBy(hosts: readonly Host[], selfId: string | undefined): Host[] {
  if (!selfId) return []
  return hosts.filter((h) => h.jumpHostId === selfId)
}

/**
 * True when this host is someone's jump and has no jump of its own yet —
 * matching Android: allow clearing an existing jump, but don't start a new nest.
 */
export function jumpSelectBlocked(
  hosts: readonly Host[],
  selfId: string | undefined,
  currentJumpId: string
): boolean {
  return jumpUsedBy(hosts, selfId).length > 0 && !currentJumpId
}

/**
 * Options for the editor <select>: base candidates, plus the currently chosen
 * jump if it is missing from the list (legacy nested data still needs a label).
 */
export function jumpSelectOptions(
  hosts: readonly Host[],
  selfId: string | undefined,
  currentJumpId: string
): Host[] {
  const base = jumpCandidates(hosts, selfId)
  if (!currentJumpId) return base
  if (base.some((h) => h.id === currentJumpId)) return base
  const cur = hosts.find((h) => h.id === currentJumpId)
  return cur ? [cur, ...base] : base
}
