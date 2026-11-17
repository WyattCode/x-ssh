import { it, expect, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => 'tmp-local' } }))
const { SshManager } = await import('./ssh')
it('F2 audits real terminal transfer events even for quiet jobs', () => {
  const audit = vi.fn()
  const mgr = new (SshManager as any)({ isDestroyed: () => false, send: vi.fn() }, {}, audit)
  mgr.sessions.set('s', { auditIdentity: { host: '::1', port: 22, username: 'u' } })
  mgr.jobSession.set('j', 's'); mgr.quietJobs.add('j')
  mgr.emitProgress({ id: 'j', direction: 'up', name: 'file', done: true, transferred: 3, total: 3 })
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'transfer', host: '::1', detail: expect.stringContaining('up') }))
})
it('F2 audits successful forwarding changes but not nonexistent removals', async () => {
  const audit = vi.fn()
  const mgr = new (SshManager as any)({}, {}, audit)
  mgr.sessions.set('s', { id: 's', client: {}, auditIdentity: { host: 'h', port: 22, username: 'u' } })
  mgr.openRule = () => []
  await mgr.addForward('s', { mode: 'dynamic', localPort: 1080 })
  mgr.removeForward('s', { mode: 'dynamic', localPort: 1080 })
  mgr.removeForward('s', { mode: 'dynamic', localPort: 1080 })
  expect(audit.mock.calls.map(c => c[0].detail)).toEqual(['add dynamic:1080', 'remove dynamic:1080'])
})
it('F2 retains main-owned audit identity until a disconnected transfer finishes', () => {
  const audit = vi.fn()
  const mgr = new (SshManager as any)({ isDestroyed: () => true }, {}, audit)
  mgr.sessions.set('s', { auditIdentity: { host: 'h', port: 2222, username: 'u' } })
  mgr.registerJob('j', 's', 'up')
  mgr.sessions.delete('s')
  mgr.emitProgress({ id: 'j', direction: 'up', name: 'file', error: 'drop', transferred: 3 })
  mgr.finishJobAudit('j')
  expect(audit).toHaveBeenCalledTimes(1)
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'transfer', host: 'h', port: 2222, detail: 'up file drop' }))
})
it('F2 audits successful configured forwards independently of a failed same-numbered rule', async () => {
  const audit = vi.fn()
  const mgr = new (SshManager as any)({}, {}, audit)
  const session = { id: 's', auditIdentity: { host: 'h', port: 22, username: 'u' } }
  mgr.sessions.set('s', session)
  mgr.openRule = () => [{ close: vi.fn() }]
  mgr.waitForListen = async () => false
  mgr.openRemoteForward = async () => true
  await mgr.openForwards(session, [{ mode: 'local', localPort: 9000 }, { mode: 'remote', localPort: 9000 }])
  expect(audit).toHaveBeenCalledTimes(1)
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'forward', detail: 'open remote:9000' }))
})
