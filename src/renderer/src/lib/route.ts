import type { ConnectParams, Host } from '../../../shared/types'

/** 实际连接路径:本机 → (跳板)→ 目标。跳板优先用已保存主机的名字,否则用地址。 */
export function routeOf(
  params: Pick<ConnectParams, 'host' | 'jump' | 'jumpHostId' | 'hostId'>,
  hosts: Pick<Host, 'id' | 'label' | 'host' | 'jumpHostId'>[]
): { hops: string[]; direct: boolean } {
  const hops: string[] = []
  const seen = new Set<string>()
  // 沿 jumpHostId 一路往上(应用只支持一层,但这里不依赖它,防环)
  // A pane opened from the library carries only its hostId: the jump comes from the saved host.
  let jumpId = params.jumpHostId ?? (params.hostId ? hosts.find((h) => h.id === params.hostId)?.jumpHostId : undefined)
  while (jumpId && !seen.has(jumpId)) {
    seen.add(jumpId)
    const j = hosts.find((h) => h.id === jumpId)
    if (!j) break
    hops.unshift(j.label)
    jumpId = j.jumpHostId
  }
  if (!hops.length && params.jump?.host) hops.push(params.jump.host)
  return { hops, direct: hops.length === 0 }
}

/** 底栏用的文字:「本机 › bastion › target」或直连时「本机 › target」。 */
export function routeText(hops: string[], target: string, local: string): string {
  return [local, ...hops, target].join(' › ')
}
