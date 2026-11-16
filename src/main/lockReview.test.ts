import { it, expect } from 'vitest'
import { MasterLock } from './lock'
it('B20 derives asynchronously and throttles repeated verification', async () => {
  const lock = new MasterLock({ set: async () => {} } as never) as any
  const deriving = lock.derive('secret', 'salt')
  expect(deriving).toBeInstanceOf(Promise)
  await deriving
  await lock.setPassphrase('secret'); lock.lock()
  expect(await lock.unlock('wrong')).toBe(false)
  expect(await lock.unlock('secret')).toBe(false)
})
