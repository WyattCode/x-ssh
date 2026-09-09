import { describe, it, expect } from 'vitest'
import {
  buildFlatTree,
  buildGrid,
  collectPaneIds,
  containsPane,
  splitLeaf,
  removePane,
  setPaneRatio,
  childSizes
} from './paneLayout'
import type { LayoutNode } from './paneLayout'

const leaf = (paneId: string): LayoutNode => ({ kind: 'leaf', paneId })

describe('buildFlatTree', () => {
  it('makes a single leaf for one pane', () => {
    expect(buildFlatTree(['a'], 'row')).toEqual(leaf('a'))
  })
  it('makes a split with equal sizes for multiple panes', () => {
    expect(buildFlatTree(['a', 'b'], 'col')).toEqual({
      kind: 'split',
      dir: 'col',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5]
    })
  })
})

describe('splitLeaf', () => {
  it('splits a root leaf into a branch, keeping the original pane', () => {
    expect(splitLeaf(leaf('a'), 'a', 'row', 'b')).toEqual({
      kind: 'split',
      dir: 'row',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5]
    })
  })
  it('supports nesting to give a 2x2 grid', () => {
    let tree = splitLeaf(leaf('a'), 'a', 'col', 'b') // a on top, b below
    tree = splitLeaf(tree, 'b', 'row', 'c') // b split horizontally with c
    expect(collectPaneIds(tree)).toEqual(['a', 'b', 'c'])
    expect(containsPane(tree, 'b')).toBe(true)
    expect(containsPane(tree, 'c')).toBe(true)
  })
})

describe('removePane', () => {
  it('collapses a branch to its only remaining child', () => {
    const tree = buildFlatTree(['a', 'b'], 'row')
    expect(removePane(tree, 'a')).toEqual(leaf('b'))
  })
  it('removes a nested leaf', () => {
    let tree = splitLeaf(leaf('a'), 'a', 'col', 'b')
    tree = splitLeaf(tree, 'b', 'row', 'c')
    tree = removePane(tree, 'b')!
    expect(collectPaneIds(tree)).toEqual(['a', 'c'])
  })
})

describe('collectPaneIds (visual/DFS order used by focus cycle & closePane)', () => {
  it('orders panes by on-screen arrangement, not insertion order', () => {
    // The store appends new panes to `panes` (insertion order) while the layout
    // tree nests the new leaf beside its source. Splitting p0 twice yields
    // panes [p0,p1,p2] but the visual/D-F-S arrangement is [p0,p2,p1].
    let tree = splitLeaf(leaf('p0'), 'p0', 'row', 'p1')
    tree = splitLeaf(tree, 'p0', 'col', 'p2')
    expect(collectPaneIds(tree)).toEqual(['p0', 'p2', 'p1'])
  })
  it('keeps the source-adjacent neighbour after a mixed split', () => {
    // A 2x2 grid built by splitting p0 (col) then p2 (row).
    let tree = splitLeaf(leaf('p0'), 'p0', 'col', 'p1')
    tree = splitLeaf(tree, 'p1', 'row', 'p2')
    expect(collectPaneIds(tree)).toEqual(['p0', 'p1', 'p2'])
    expect(containsPane(tree, 'p2')).toBe(true)
  })
})

describe('buildGrid', () => {
  it('makes a single pane stay a leaf', () => {
    expect(buildGrid(['a'], 1, 1)).toEqual({ kind: 'leaf', paneId: 'a' })
  })
  it('2 cols yields a flat row split', () => {
    expect(buildGrid(['a', 'b'], 1, 2)).toEqual(buildFlatTree(['a', 'b'], 'row'))
  })
  it('2 rows yields a flat col split', () => {
    expect(buildGrid(['a', 'b'], 2, 1)).toEqual(buildFlatTree(['a', 'b'], 'col'))
  })
  it('2x2 yields nested rows-of-columns, all 4 panes in row-major order', () => {
    const g = buildGrid(['a', 'b', 'c', 'd'], 2, 2)
    expect(collectPaneIds(g)).toEqual(['a', 'b', 'c', 'd'])
    expect(g.kind).toBe('split')
    const outer = g as Extract<LayoutNode, { kind: 'split' }>
    expect(outer.dir).toBe('col') // rows stacked
    expect(outer.children).toHaveLength(2)
    const row0 = outer.children[0] as Extract<LayoutNode, { kind: 'split' }>
    const row1 = outer.children[1] as Extract<LayoutNode, { kind: 'split' }>
    expect(row0.kind).toBe('split')
    expect(row0.dir).toBe('row') // columns side-by-side
    expect(collectPaneIds(row0)).toEqual(['a', 'b'])
    expect(collectPaneIds(row1)).toEqual(['c', 'd'])
  })
  it('handles a ragged cell count (3 panes in a 2x2 grid)', () => {
    const g = buildGrid(['a', 'b', 'c'], 2, 2)
    expect(g.kind).toBe('split')
    expect(collectPaneIds(g)).toEqual(['a', 'b', 'c'])
  })
})

describe('setPaneRatio', () => {
  it('moves the pair ratio and keeps the total at 1', () => {
    const tree = buildFlatTree(['a', 'b', 'c'], 'row')
    const r = setPaneRatio(tree, [], 1, 0.8)
    const sizes = childSizes(r as Extract<LayoutNode, { kind: 'split' }>)
    expect(Math.abs(sizes.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(0.001)
    expect(sizes[1]).toBeGreaterThan(sizes[2])
  })
  it('clamps so neither child collapses', () => {
    const tree = buildFlatTree(['a', 'b'], 'row')
    const r = setPaneRatio(tree, [], 0, 0.99)
    const sizes = childSizes(r as Extract<LayoutNode, { kind: 'split' }>)
    expect(Math.min(...sizes)).toBeGreaterThan(0)
  })
})
