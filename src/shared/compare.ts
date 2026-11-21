// 并排排障的「对照」:两台主机各跑同一组固定命令,再把结果对比成一句话。
//
// 命令由主进程拼,渲染进程只能选 metric 和填服务名,不能递任意命令;服务名在这里
// 校验,不合格直接拒绝(它会进 shell 命令行)。

export type CompareMetric = 'service' | 'disk'

export const COMPARE_METRICS: CompareMetric[] = ['service', 'disk']
export const DEFAULT_COMPARE_SERVICE = 'nginx'

/** systemd 单元名 / 可执行文件名能用的字符,够常见服务(nginx、sshd、docker、foo@bar)用了。 */
const SERVICE_RE = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,47}$/

export function isValidService(name: unknown): name is string {
  return typeof name === 'string' && SERVICE_RE.test(name)
}

/** 每个 metric 要在两端各跑的命令(顺序固定,和界面里的两行输出一一对应)。 */
export function compareCommands(metric: CompareMetric, service: string): string[] {
  if (metric === 'disk') return ['df -h / 2>&1 | tail -n 2', 'df -ih / 2>&1 | tail -n 2']
  if (!isValidService(service)) throw new Error('invalid-service')
  // 很多服务把版本打到 stderr(nginx -v),所以合并;-v 不认的程序会打一行用法,取第一行即可。
  return [`${service} -v 2>&1 | head -n 1`, `systemctl is-active ${service} 2>&1 | head -n 1`]
}

/** 界面上显示的命令(与实际运行的一致,只是去掉管道里的截断,读起来更像人敲的)。 */
export function compareCommandLabels(metric: CompareMetric, service: string): string[] {
  return metric === 'disk' ? ['df -h /', 'df -ih /'] : [`${service} -v`, `systemctl is-active ${service}`]
}

export interface CompareSide {
  /** 界面上的称呼(主机名)。 */
  name: string
  /** 与 compareCommands 一一对应的输出;失败时为 null。 */
  outputs: (string | null)[]
}

export type CompareSummary =
  | { kind: 'incomplete' }
  | { kind: 'version'; same: boolean; a?: string; b?: string; nameA: string; nameB: string }
  | { kind: 'active'; bothActive: boolean; inactive: string[] }
  | { kind: 'disk'; higher: string; lower: string; diff: number }
  | { kind: 'diskSame' }

/** nginx/1.24.0、nginx version: nginx/1.24.0、v1.2.3、Docker version 27.1.1 …… 里的版本号。 */
export function extractVersion(line: string | null): string | undefined {
  if (!line) return undefined
  const m = line.match(/(\d+\.\d+(?:\.\d+)*(?:[-+~][0-9A-Za-z.]+)?)/)
  return m?.[1]
}

/** df 输出里根分区那一行的 Use% / IUse%,取最后一个百分数。 */
export function extractUsePercent(out: string | null): number | undefined {
  if (!out) return undefined
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const row = [...lines].reverse().find((l) => /\d+%/.test(l))
  const m = row?.match(/(\d+)%/)
  return m ? Number(m[1]) : undefined
}

export function summarizeCompare(metric: CompareMetric, a: CompareSide, b: CompareSide): CompareSummary {
  if (metric === 'disk') {
    const ua = extractUsePercent(a.outputs[0])
    const ub = extractUsePercent(b.outputs[0])
    if (ua === undefined || ub === undefined) return { kind: 'incomplete' }
    if (ua === ub) return { kind: 'diskSame' }
    return ua > ub
      ? { kind: 'disk', higher: a.name, lower: b.name, diff: ua - ub }
      : { kind: 'disk', higher: b.name, lower: a.name, diff: ub - ua }
  }
  const va = extractVersion(a.outputs[0])
  const vb = extractVersion(b.outputs[0])
  const sa = a.outputs[1]?.trim()
  const sb = b.outputs[1]?.trim()
  if (va === undefined && vb === undefined && !sa && !sb) return { kind: 'incomplete' }
  return { kind: 'version', same: va !== undefined && va === vb, a: va, b: vb, nameA: a.name, nameB: b.name }
}

/** 服务状态那一行的结论,和版本结论分开,两句拼起来。 */
export function summarizeActive(a: CompareSide, b: CompareSide): CompareSummary {
  const inactive: string[] = []
  if (a.outputs[1]?.trim() !== 'active') inactive.push(a.name)
  if (b.outputs[1]?.trim() !== 'active') inactive.push(b.name)
  return { kind: 'active', bothActive: inactive.length === 0, inactive }
}

export type ManySummary =
  | { kind: 'incomplete' }
  | { kind: 'version'; same: boolean; v?: string; items: { name: string; v?: string }[] }
  | { kind: 'disk'; same: boolean; high: { name: string; pct: number }; low: { name: string; pct: number } }

/** Three or more hosts: one sentence for the whole set (the two-host wording
 *  names a pair). Versions: all alike, or the list of who has what. Disk: the
 *  fullest and the emptiest root partition. */
export function summarizeMany(metric: CompareMetric, sides: CompareSide[]): ManySummary {
  if (metric === 'disk') {
    const rows = sides.map((s) => ({ name: s.name, pct: extractUsePercent(s.outputs[0]) }))
    const known = rows.filter((r): r is { name: string; pct: number } => r.pct !== undefined)
    if (known.length < sides.length || !known.length) return { kind: 'incomplete' }
    const sorted = [...known].sort((x, y) => y.pct - x.pct)
    return { kind: 'disk', same: sorted[0].pct === sorted[sorted.length - 1].pct, high: sorted[0], low: sorted[sorted.length - 1] }
  }
  const items = sides.map((s) => ({ name: s.name, v: extractVersion(s.outputs[0]) }))
  const states = sides.map((s) => s.outputs[1]?.trim())
  if (items.every((i) => i.v === undefined) && states.every((x) => !x)) return { kind: 'incomplete' }
  const first = items[0]?.v
  return { kind: 'version', same: first !== undefined && items.every((i) => i.v === first), v: first, items }
}

/** Names of the hosts whose service is not 'active' (any number of hosts). */
export function inactiveNames(sides: CompareSide[]): string[] {
  return sides.filter((s) => s.outputs[1]?.trim() !== 'active').map((s) => s.name)
}
