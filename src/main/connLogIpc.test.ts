import { it, expect, vi } from 'vitest'
import { rendererConnLogPush } from './connLogIpc'
it('B12 rejects renderer-supplied audit entries without persisting them', async () => {
  const push = vi.fn()
  expect(await rendererConnLogPush({ event: 'connected' } as never, push)).toEqual({ ok: false })
  expect(push).not.toHaveBeenCalled()
})
