import { describe, expect, it } from 'vitest'
import { extractBackupHosts } from './backup'

/**
 * The previous exporter wrote `store.exportJson()` (a JSON string) into
 * `data.hosts`, while the importer required an array — so every backup was
 * rejected and could never be restored. These cases pin both the old shape and
 * the new one.
 */
describe('extractBackupHosts', () => {
  const hosts = [{ id: 'a', host: 'example.com' }]

  it('accepts a plain array', () => {
    expect(extractBackupHosts(hosts)).toEqual(hosts)
  })

  it('accepts what the old exporter wrote: a JSON string of {hosts}', () => {
    const legacy = JSON.stringify({ app: 'x-ssh', version: 1, hosts })
    expect(extractBackupHosts(legacy)).toEqual(hosts)
  })

  it('accepts a JSON string of an array', () => {
    expect(extractBackupHosts(JSON.stringify(hosts))).toEqual(hosts)
  })

  it('accepts the new structured object', () => {
    expect(extractBackupHosts({ app: 'x-ssh', version: 1, hosts })).toEqual(hosts)
  })

  it('rejects payloads with no host list', () => {
    expect(extractBackupHosts(undefined)).toBeNull()
    expect(extractBackupHosts(null)).toBeNull()
    expect(extractBackupHosts('not json')).toBeNull()
    expect(extractBackupHosts('{"nope":1}')).toBeNull()
    expect(extractBackupHosts({ hosts: 'still a string' })).toBeNull()
  })
})
