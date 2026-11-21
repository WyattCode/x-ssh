// Host grouping and ordering, as pure functions (the rail, the editor and main share them).
//
//  - A host's group is what the user set (`group`), or, when `autoGroup` is on and the user
//    has not decided (`groupLocked` unset), one derived from its name: "AI TOP ATOM 0",
//    "AI TOP ATOM 1" … share the prefix "AI TOP ATOM". Derived groups are never written
//    to the data, so renaming a host or adding one just regroups.
//  - Order inside a group follows the chosen sort. 'name' is the natural order (0, 1, 2,
//    10), 'custom' is the hand-made `order`.
import type { Host } from './types'

export type HostsSort = 'recent' | 'name' | 'address' | 'custom'
export const HOSTS_SORTS: HostsSort[] = ['recent', 'name', 'address', 'custom']
export const DEFAULT_HOSTS_SORT: HostsSort = 'name'
export const UNGROUPED = ''
/** The longest group name the editor and the rail accept. */
export const MAX_GROUP_LEN = 40

export function isHostsSort(v: unknown): v is HostsSort {
  return typeof v === 'string' && (HOSTS_SORTS as string[]).includes(v)
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const compareNatural = (a: string, b: string): number => collator.compare(a, b)

/** "AI TOP ATOM 3" → { prefix: 'AI TOP ATOM', n: 3 }. The number has to stand alone at the end
 *  (space, dash or underscore before it) and be at most three digits, so "Ubuntu 26.04" and
 *  "Ubuntu 26.04 5090" are not mistaken for numbered series. */
export function splitSeries(label: string): { prefix: string; n: number } | null {
  // A hand-edited or imported file can hold anything in a field; a rail that throws on it is worse than a wrong group.
  if (typeof label !== 'string') return null
  const m = /^(.*\S)[\s_-]+(\d{1,3})$/.exec(label.trim())
  if (!m) return null
  const prefix = m[1].replace(/[\s_-]+$/, '').trim()
  if (!prefix) return null
  return { prefix, n: Number(m[2]) }
}

/** Name groups found among hosts that have no say of their own: prefix (lower-cased) → the
 *  spelling of the first member. Only prefixes shared by at least two hosts count. */
export function autoGroupNames(hosts: Host[]): Map<string, string> {
  const seen = new Map<string, { name: string; n: number }>()
  for (const h of hosts) {
    if (ownGroup(h) || h.groupLocked) continue
    const s = splitSeries(h.label)
    if (!s) continue
    const k = s.prefix.toLowerCase()
    const e = seen.get(k)
    if (e) e.n++
    else seen.set(k, { name: s.prefix.slice(0, MAX_GROUP_LEN), n: 1 })
  }
  const out = new Map<string, string>()
  for (const [k, v] of seen) if (v.n >= 2) out.set(k, v.name)
  return out
}

/** The group the user set, '' when none (a non-string in the data counts as none). */
function ownGroup(h: Host): string {
  return typeof h.group === 'string' ? h.group.trim() : ''
}

export interface GroupedHost {
  host: Host
  /** The group the host sits in ('' = none) and whether the user put it there. */
  group: string
  auto: boolean
}

/** Every host with the group it shows under. */
export function effectiveGroups(hosts: Host[], autoOn: boolean): GroupedHost[] {
  const auto = autoOn ? autoGroupNames(hosts) : new Map<string, string>()
  return hosts.map((host) => {
    const own = ownGroup(host)
    if (own) return { host, group: own, auto: false }
    if (!host.groupLocked) {
      const s = splitSeries(host.label)
      const name = s ? auto.get(s.prefix.toLowerCase()) : undefined
      if (name) return { host, group: name, auto: true }
    }
    return { host, group: UNGROUPED, auto: false }
  })
}

export function compareHosts(sort: HostsSort): (a: Host, b: Host) => number {
  switch (sort) {
    case 'name':
      return (a, b) => compareNatural(a.label, b.label)
    case 'address':
      return (a, b) => compareNatural(a.host, b.host) || a.port - b.port
    case 'custom':
      return (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || compareNatural(a.label, b.label)
    default:
      return (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  }
}

export interface HostGroup {
  name: string
  hosts: Host[]
  /** Every member got here by name, none by the user. */
  auto: boolean
}

/** The rail's groups: named ones first (in `groupOrder` when sorting by hand, else A→Z),
 *  ungrouped last, hosts inside each by `sort`. */
export function buildGroups(
  hosts: Host[],
  opts: { sort: HostsSort; autoOn: boolean; groupOrder?: string[]; ungroupedLabel: string }
): HostGroup[] {
  // Keyed by lower case, so 'AI TOP ATOM' and 'ai top atom' are one group (the first spelling shows).
  const map = new Map<string, { name: string; hosts: Host[]; manual: boolean }>()
  for (const g of effectiveGroups(hosts, opts.autoOn)) {
    const key = g.group.toLowerCase()
    const e = map.get(key) ?? { name: g.group, hosts: [], manual: false }
    e.hosts.push(g.host)
    if (!g.auto) e.manual = true
    map.set(key, e)
  }
  const cmp = compareHosts(opts.sort)
  const order = opts.groupOrder ?? []
  const rank = (name: string): number => {
    const i = order.findIndex((o) => o.toLowerCase() === name.toLowerCase())
    return i < 0 ? Infinity : i
  }
  return [...map.values()]
    .sort(({ name: a }, { name: b }) => {
      if (a === UNGROUPED || b === UNGROUPED) return (a === UNGROUPED ? 1 : 0) - (b === UNGROUPED ? 1 : 0)
      if (opts.sort === 'custom') return rank(a) - rank(b) || compareNatural(a, b)
      return compareNatural(a, b)
    })
    .map((e) => ({
      name: e.name || opts.ungroupedLabel,
      hosts: e.hosts.sort(cmp),
      auto: !e.manual && e.name !== UNGROUPED
    }))
}

export interface HostPatch {
  id: string
  /** The group to set; '' puts the host in none. Absent leaves it. */
  group?: string
  /** True once the user decided (an explicit group, or "no group"): the name rule leaves it alone. */
  groupLocked?: boolean
  /** Position in a hand-made order; null forgets it. */
  order?: number | null
}

/** Applies patches to a copy of the list; unknown ids and bad values are ignored. */
export function applyHostPatches(hosts: Host[], patches: HostPatch[]): Host[] {
  const byId = new Map(patches.map((p) => [p.id, p]))
  return hosts.map((h) => {
    const p = byId.get(h.id)
    if (!p) return h
    const next: Host = { ...h }
    if (typeof p.group === 'string') {
      const g = p.group.trim().slice(0, MAX_GROUP_LEN)
      if (g) next.group = g
      else delete next.group
    }
    if (typeof p.groupLocked === 'boolean') {
      if (p.groupLocked) next.groupLocked = true
      else delete next.groupLocked
    }
    if (p.order === null) delete next.order
    else if (typeof p.order === 'number' && Number.isFinite(p.order)) next.order = p.order
    return next
  })
}

/** Patches that make `orderedIds` the order of one list (0, 1, 2 …). The hosts in `moved` are
 *  also put in `group` ('' = none) as the user's own decision (locked); the others keep whatever
 *  made them members, so a name-based group keeps growing by name. */
export function patchesForOrder(orderedIds: string[], group: string, moved: string[]): HostPatch[] {
  return orderedIds.map((id, i) =>
    moved.includes(id) ? { id, group, groupLocked: true, order: i } : { id, order: i }
  )
}

/** The ids of a group in the order shown, with `moved` taken out and put before `beforeId`
 *  (or at the end when `beforeId` is null). */
export function insertBefore(ids: string[], moved: string[], beforeId: string | null): string[] {
  const rest = ids.filter((id) => !moved.includes(id))
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId)
  rest.splice(at < 0 ? rest.length : at, 0, ...moved)
  return rest
}

/** The group names after moving `name` before `beforeName` (null = last). `all` is the groups
 *  as shown now, so groups the stored order does not know yet keep their place. */
export function reorderGroupNames(all: string[], name: string, beforeName: string | null): string[] {
  return insertBefore(all, [name], beforeName)
}

/** Names in use (for the editor's dropdown and the move menu), A→Z, with counts. */
export function groupNames(groups: HostGroup[], ungroupedLabel: string): { name: string; count: number }[] {
  return groups.filter((g) => g.name !== ungroupedLabel).map((g) => ({ name: g.name, count: g.hosts.length }))
}
