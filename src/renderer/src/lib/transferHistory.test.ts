import { describe, it, expect } from 'vitest'
import type { TransferHistoryItem } from '../../../shared/types'
import { canRetryHistory, buildRetryItems, canRevealHistory } from './transferHistory'

function item(partial: Partial<TransferHistoryItem>): TransferHistoryItem {
  return {
    id: 'x',
    name: 'a',
    direction: 'down',
    bytes: 1,
    status: 'error',
    at: Date.now(),
    ...partial
  }
}

describe('canRetryHistory', () => {
  it('is false for uploads even when errored', () => {
    expect(canRetryHistory(item({ direction: 'up', localDir: 'C:\\x' }))).toBe(false)
  })
  it('is false for successful transfers', () => {
    expect(canRetryHistory(item({ status: 'done', localDir: 'C:\\x' }))).toBe(false)
  })
  it('is false when there is no local destination', () => {
    expect(canRetryHistory(item({ remoteDir: '/r' }))).toBe(false)
  })
  it('allows a single-file download', () => {
    expect(canRetryHistory(item({ remoteDir: '/r', localDir: 'C:\\x', isDir: false }))).toBe(true)
  })
  it('allows a multi-item download that recorded its items', () => {
    expect(
      canRetryHistory(item({ remoteDir: '/r', localDir: 'C:\\x', items: [{ path: '/r/a', name: 'a', isDir: false }] }))
    ).toBe(true)
  })
  it('rejects a multi-item download without recorded items', () => {
    expect(canRetryHistory(item({ remoteDir: '/r', localDir: 'C:\\x', count: 3 }))).toBe(false)
  })
})

describe('buildRetryItems', () => {
  it('uses the recorded items when present', () => {
    const items = [{ path: '/r/a', name: 'a', isDir: false }]
    expect(buildRetryItems(item({ remoteDir: '/r', localDir: 'C:\\x', items }))).toEqual(items)
  })
  it('reconstructs a single-file item from remotePath', () => {
    expect(buildRetryItems(item({ remoteDir: '/r', localDir: 'C:\\x', remotePath: '/r/file', isDir: false }))).toEqual([
      { path: '/r/file', name: 'a', isDir: false }
    ])
  })
  it('falls back to joining remoteDir and name', () => {
    expect(buildRetryItems(item({ remoteDir: '/r', localDir: 'C:\\x', name: 'file', isDir: false }))).toEqual([
      { path: '/r/file', name: 'file', isDir: false }
    ])
  })
})

describe('canRevealHistory', () => {
  it('is false for errored transfers', () => {
    expect(canRevealHistory(item({ status: 'error', localDir: 'C:\\x' }))).toBe(false)
  })
  it('allows a finished download with a local destination', () => {
    expect(canRevealHistory(item({ status: 'done', localDir: 'C:\\x' }))).toBe(true)
  })
  it('allows a finished upload with a local source', () => {
    expect(canRevealHistory(item({ status: 'done', direction: 'up', localPaths: ['C:\\src'] }))).toBe(true)
  })
  it('rejects a finished upload without a recorded source', () => {
    expect(canRevealHistory(item({ status: 'done', direction: 'up', remoteDir: '/r' }))).toBe(false)
  })
})
