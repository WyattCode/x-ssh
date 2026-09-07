import { describe, it, expect } from 'vitest'
import {
  buildFlatTree,
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
