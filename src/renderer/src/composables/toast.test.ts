import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useToast } from './toast'

/**
 * Toasts were an append-only list, so anything firing per attempt stacked up
 * forever. A user re-clicking "trust this key" on a failing host produced
 * eight identical banners covering the card they were reading.
 */
describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The store is module-level state shared across tests: drain it so each
    // case starts from a known empty list.
    const { list, dismiss } = useToast()
    for (const t of [...list]) dismiss(t.id)
  })

  it('collapses an identical message into one toast', () => {
    const { list, toast } = useToast()
    for (let i = 0; i < 8; i++) toast('无法保存主机密钥,连接已中止', 'error')
    expect(list).toHaveLength(1)
    expect(list[0].message).toBe('无法保存主机密钥,连接已中止')
  })

  it('keeps different messages apart', () => {
    const { list, toast } = useToast()
    toast('A', 'error')
    toast('B', 'error')
    expect(list.map((t) => t.message)).toEqual(['A', 'B'])
  })

  it('treats the same text at a different severity as a separate toast', () => {
    // 'Saved' as success and as error are two different claims.
    const { list, toast } = useToast()
    toast('x', 'success')
    toast('x', 'error')
    expect(list).toHaveLength(2)
  })

  it('restarts the dismiss clock instead of letting the old one fire early', () => {
    const { list, toast } = useToast()
    toast('slow', 'info', 3000)
    vi.advanceTimersByTime(2000)
    expect(list).toHaveLength(1)

    toast('slow', 'info', 3000) // repeat: clock restarts, old timer cancelled
    vi.advanceTimersByTime(2000)
    expect(list, 'still showing after 4s total because it was renewed at 2s').toHaveLength(1)

    vi.advanceTimersByTime(1100)
    expect(list).toHaveLength(0)
  })

  it('moves a repeated toast to the end so the newest is nearest the corner', () => {
    const { list, toast } = useToast()
    toast('first', 'info', 0)
    toast('second', 'info', 0)
    toast('first', 'info', 0)
    expect(list.map((t) => t.message)).toEqual(['second', 'first'])
  })

  it('a duration of 0 stays until dismissed', () => {
    const { list, toast } = useToast()
    toast('sticky', 'error', 0)
    vi.advanceTimersByTime(60_000)
    expect(list).toHaveLength(1)
  })

  it('dismiss removes only the given toast', () => {
    const { list, toast, dismiss } = useToast()
    toast('a', 'info', 0)
    toast('b', 'info', 0)
    dismiss(list[0].id)
    expect(list.map((t) => t.message)).toEqual(['b'])
  })
})