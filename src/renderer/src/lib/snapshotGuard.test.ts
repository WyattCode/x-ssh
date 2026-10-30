import { describe, expect, it } from 'vitest'
import { closeOthersNeedsConfirm, hasLiveConnectedPane } from './snapshotGuard'

type Pane = { status: string }
type Tab = { id: string; panes: Pane[] }

const pane = (status: string): Pane => ({ status })
const tab = (id: string, ...statuses: string[]): Tab => ({ id, panes: statuses.map(pane) })

describe('hasLiveConnectedPane', () => {
  it('is false with no tabs', () => {
    expect(hasLiveConnectedPane([])).toBe(false)
  })

  it('is false when every pane is closed, connecting or errored', () => {
    const tabs = [tab('a', 'closed', 'connecting'), tab('b', 'error', 'closed')]
    expect(hasLiveConnectedPane(tabs)).toBe(false)
  })

  it('is false for tabs without panes', () => {
    expect(hasLiveConnectedPane([tab('a'), tab('b')])).toBe(false)
  })

  it('is true when a single pane is connected', () => {
    expect(hasLiveConnectedPane([tab('a', 'closed', 'connected')])).toBe(true)
  })

  it('is true when only one tab of many is live', () => {
    const tabs = [tab('a', 'closed'), tab('b', 'connecting', 'connected'), tab('c', 'error')]
    expect(hasLiveConnectedPane(tabs)).toBe(true)
  })
})

describe('closeOthersNeedsConfirm', () => {
  it('is false when confirmClose is disabled, even with live others', () => {
    const tabs = [tab('keep', 'connected'), tab('other', 'connected')]
    expect(closeOthersNeedsConfirm(false, tabs, 'keep')).toBe(false)
  })

  it('is false when the other tabs are only closed', () => {
    const tabs = [tab('keep', 'connected'), tab('other', 'closed'), tab('third', 'error')]
    expect(closeOthersNeedsConfirm(true, tabs, 'keep')).toBe(false)
  })

  it('is true when another tab still has a connected pane', () => {
    const tabs = [tab('keep', 'closed'), tab('other', 'connecting', 'connected')]
    expect(closeOthersNeedsConfirm(true, tabs, 'keep')).toBe(true)
  })

  it('is false when only the kept tab is live', () => {
    const tabs = [tab('keep', 'connected'), tab('other', 'closed')]
    expect(closeOthersNeedsConfirm(true, tabs, 'keep')).toBe(false)
  })

  it('is false when there are no other tabs', () => {
    expect(closeOthersNeedsConfirm(true, [tab('keep', 'connected')], 'keep')).toBe(false)
    expect(closeOthersNeedsConfirm(true, [], 'keep')).toBe(false)
  })

  it('is true when both the kept tab and another tab are live', () => {
    const tabs = [tab('keep', 'connected'), tab('other', 'connected')]
    expect(closeOthersNeedsConfirm(true, tabs, 'keep')).toBe(true)
  })
})
