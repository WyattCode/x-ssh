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
it('B20 does not unlock when the user locks during asynchronous passphrase replacement', async () => {
  const lock = new MasterLock({ set: async () => {} } as never) as any
  await lock.setPassphrase('old')
  let complete: (hash: string) => void = () => {}
  lock.derive = () => new Promise<string>(resolve => { complete = resolve })
  const pending = lock.setPassphrase('new')
  lock.lock()
  complete('00'.repeat(64)); await pending
  expect(lock.locked).toBe(true)
})
