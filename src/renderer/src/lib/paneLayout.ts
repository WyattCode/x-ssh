/**
 * Pure helpers for the per-tab split layout tree. A tab's panes form a tree:
 * leaves are panes, split branches carry a direction and proportional sizes
 * (for resizable dividers). Kept dependency-free so it can be unit-tested.
 */

export type SplitDir = 'row' | 'col'

export type LayoutNode =
  | { kind: 'leaf'; paneId: string }
  | { kind: 'split'; dir: SplitDir; children: LayoutNode[]; sizes?: number[] }

/** Builds a simple (flat) tree from panes laid out in one direction. */
export function buildFlatTree(paneIds: string[], dir: SplitDir): LayoutNode {
  if (paneIds.length === 0) return { kind: 'split', dir, children: [], sizes: [] }
  if (paneIds.length === 1) return { kind: 'leaf', paneId: paneIds[0] }
  return {
    kind: 'split',
    dir,
    children: paneIds.map((paneId) => ({ kind: 'leaf', paneId }) as LayoutNode),
    sizes: paneIds.map(() => 1 / paneIds.length)
  }
}

/** All pane ids referenced by the tree, in display (depth-first) order. */
export function collectPaneIds(node: LayoutNode): string[] {
  if (node.kind === 'leaf') return [node.paneId]
  return node.children.flatMap(collectPaneIds)
}

/** True if `paneId` is a leaf anywhere in the tree. */
export function containsPane(node: LayoutNode, paneId: string): boolean {
  if (node.kind === 'leaf') return node.paneId === paneId
  return node.children.some((c) => containsPane(c, paneId))
}

/** Splits the pane `paneId`: its leaf becomes a branch in `dir` holding the
 *  existing pane and a brand-new one, split evenly. */
export function splitLeaf(
  node: LayoutNode,
  paneId: string,
  dir: SplitDir,
  newPaneId: string
): LayoutNode {
  if (node.kind === 'leaf') {
    if (node.paneId !== paneId) return node
    return {
      kind: 'split',
      dir,
      children: [{ kind: 'leaf', paneId }, { kind: 'leaf', paneId: newPaneId }],
      sizes: [0.5, 0.5]
    }
  }
  const idx = node.children.findIndex((c) => containsPane(c, paneId))
  if (idx === -1) return node
  const children = [...node.children]
  children[idx] = splitLeaf(children[idx], paneId, dir, newPaneId)
  return { ...node, children }
}

/** Normalized relative sizes for a branch's children (defaults to equal). */
export function childSizes(node: Extract<LayoutNode, { kind: 'split' }>): number[] {
  if (node.sizes && node.sizes.length === node.children.length) {
    const sum = node.sizes.reduce((a, b) => a + b, 0) || 1
    return node.sizes.map((s) => s / sum)
  }
  const n = node.children.length || 1
  return node.children.map(() => 1 / n)
}

/** Removes the leaf for `paneId`, collapsing a branch that drops to one child. */
export function removePane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.kind === 'leaf') return node.paneId === paneId ? null : node
  const oldSizes =
    node.sizes && node.sizes.length === node.children.length
      ? node.sizes
      : node.children.map(() => 1 / node.children.length)
  const children: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((c, i) => {
    const r = removePane(c, paneId)
    if (r) {
      children.push(r)
      sizes.push(oldSizes[i])
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { kind: 'split', dir: node.dir, children, sizes }
}

/** Sets the relative size of the child `i` (as a fraction of the adjacent
 *  pair `i`+`i+1`) in the branch at `path`, keeping the pair's total constant.
 *  Returns a new tree. */
export function setPaneRatio(
  node: LayoutNode,
  path: number[],
  i: number,
  ratio: number
): LayoutNode {
  if (node.kind === 'leaf') return node
  if (path.length === 0) {
    const sizes = childSizes(node)
    if (i < 0 || i + 1 >= sizes.length) return node
    const pairSum = sizes[i] + sizes[i + 1]
    const min = Math.min(0.3, Math.max(0.05, pairSum * 0.08))
    const r = Math.max(min, Math.min(1 - min, ratio))
    sizes[i] = pairSum * r
    sizes[i + 1] = pairSum * (1 - r)
    const sum = sizes.reduce((x, y) => x + y, 0) || 1
    return { ...node, children: node.children, sizes: sizes.map((s) => s / sum) }
  }
  const [head, ...rest] = path
  const children = [...node.children]
  children[head] = setPaneRatio(children[head], rest, i, ratio)
  return { ...node, children }
}
