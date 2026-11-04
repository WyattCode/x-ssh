import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Guard against the merge leftover that made "trust this key" always fail.
 *
 * ipcMain's ssh:trustHostKey handler had its persist block written twice: the
 * first takeRejectedKey() deleted the pending rejection, so the second one
 * answered { ok: false } on a path where the key had already been written.
 * The user saw "无法保存主机密钥,连接已中止" over a working trust, re-clicked,
 * and stacked a banner per click.
 *
 * The handler is not cheap to unit-test (ipcMain, SettingsStore, a real
 * known_hosts file), so this pins the property that actually broke: the
 * rejection is consumed exactly once.
 */
describe('ssh:trustHostKey handler', () => {
  const src = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')

  /** The handler body, from its IPC name to the closing of the handler call. */
  function handlerBody(): string {
    const start = src.indexOf('IPC.sshTrustHostKey')
    expect(start, 'sshTrustHostKey handler not found — did it get renamed?').toBeGreaterThan(-1)
    const end = src.indexOf('// ---- Session log-to-file ----', start)
    expect(end, 'could not find the end of the handler').toBeGreaterThan(start)
    // Comments explain this very bug, so they mention the call by name; strip
    // them before counting or the explanation trips its own guard.
    return src
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  it('consumes the pending rejection exactly once', () => {
    const calls = handlerBody().match(/takeRejectedKey\(/g) ?? []
    // Two occurrences would mean the duplicated block is back: the second call
    // can never succeed, so every trust reports failure after writing the key.
    expect(calls).toHaveLength(1)
  })

  it('persists known_hosts exactly once', () => {
    const calls = handlerBody().match(/knownHosts\.set\(/g) ?? []
    expect(calls).toHaveLength(1)
  })

  it('checks the rejection without consuming it before writing', () => {
    const body = handlerBody()
    const check = body.indexOf('matchesRejectedKey(')
    const set = body.indexOf('knownHosts.set(')
    const take = body.indexOf('takeRejectedKey(')
    expect(check, 'the non-consuming gate is missing').toBeGreaterThan(-1)
    // Order is the whole point: a gate that consumes first leaves the slot
    // empty when the write fails, so a retry cannot work.
    expect(check).toBeLessThan(set)
    expect(set).toBeLessThan(take)
  })

  it('reports a write failure with a code instead of a bare ok:false', () => {
    // A bare { ok: false } reaches the user as no explanation at all.
    const body = handlerBody()
    expect(body).toContain("code: corrupt ? ('corrupt' as const) : ('error' as const)")
  })
})